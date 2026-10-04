// kws-process.cjs —— 语音唤醒(KWS)子进程,跑在 Electron utilityProcess 里
//
// 为什么要独立进程:sherpa-onnx 自带一份 onnxruntime,而后端 @huggingface/transformers
// 走 onnxruntime-node 另带一份;同一进程加载两份 onnxruntime 会在构建会话时原生崩溃
// (已用 probe 坐实)。把 KWS 隔离到只加载 sherpa 的独立进程,从根上消除冲突。
//
// 协议(parentPort):
//   收 {type:'init', modelDir, logFile}  → 构建 KeywordSpotter,回 {type:'ready'} / {type:'error'}
//   收 {type:'pcm',  buf:ArrayBuffer}    → 喂 16kHz Float32,命中则写日志 + 回 {type:'hit', keyword}
const fs = require('fs')
const path = require('path')

const KEYWORDS_THRESHOLD = 0.35 // 从 0.25 上调到 0.35，减少误触发
const KEYWORDS_SCORE = 3.0      // 实测 score=3 召回最佳(13/17 vs 2.0 的 9/17)
const COOLDOWN_MS = 800 // 命中后冷却:去重一次唤醒的多帧结果,又允许~1s 间隔的重试都触发

let spotter = null
let stream = null
let sherpa = null
let logFile = null

// utilityProcess 用 process.parentPort 收消息(不是 process.on('message'))
const parentPort = process.parentPort

function post(msg) {
  try { parentPort.postMessage(msg) } catch {}
}

function log(line) {
  try { if (logFile) fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`) } catch {}
  console.log(`[kws] ${line}`)
}

// init 失败统一出口：记日志 + 回 error 消息，调用方按需 return
function fail(msg) {
  log('ERROR: ' + msg)
  post({ type: 'error', error: msg })
}

// ─── 初始化:加载 sherpa + 建 KeywordSpotter ───
function init({ modelDir, logFile: lf }) {
  logFile = lf || null
  // 守卫：畸形 init（缺/非字符串 modelDir）会让下方 path.join 抛 TypeError；
  // 消息处理器没有顶层 try，未捕获异常会杀掉整个子进程且父进程无重启。
  if (typeof modelDir !== 'string' || !modelDir) {
    return fail('init 缺少 modelDir')
  }
  try {
    sherpa = require('sherpa-onnx-node')
  } catch (e) {
    return fail(`sherpa-onnx-node 加载失败: ${e && e.message || e}`)
  }

  // 模型文件路径(transducer: encoder/decoder/joiner + tokens + keywords)
  const encoder = path.join(modelDir, 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx')
  const decoder = path.join(modelDir, 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx')
  const joiner = path.join(modelDir, 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx')
  const tokens = path.join(modelDir, 'tokens.txt')
  const keywordsFile = path.join(modelDir, 'keywords.txt')

  for (const f of [encoder, decoder, joiner, tokens, keywordsFile]) {
    if (!fs.existsSync(f)) {
      return fail(`模型文件缺失: ${f}`)
    }
  }

  try {
    spotter = new sherpa.KeywordSpotter({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder, decoder, joiner },
        tokens,
        numThreads: 1,
        debug: 0,
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: KEYWORDS_SCORE,
      keywordsThreshold: KEYWORDS_THRESHOLD,
      keywordsFile,
    })
    stream = spotter.createStream()
    log(`KWS 就绪 (threshold=${KEYWORDS_THRESHOLD} score=${KEYWORDS_SCORE})`)
    post({ type: 'ready' })
  } catch (e) {
    fail(`KeywordSpotter 构建失败: ${e && e.message || e}`)
    spotter = null
    stream = null
  }
}

// ─── 喂 PCM + 检测命中 ───
let lastHitTs = 0
let pcmCount = 0             // 诊断:PCM 块计数(每 100 块=10s 记一次,确认音频在流入)
let lastDiagTs = 0
function feedPcm(buf) {
  if (!spotter || !stream) return
  try {
    pcmCount++
    const diagNow = Date.now()
    if (diagNow - lastDiagTs >= 10000) {
      lastDiagTs = diagNow
      log(`PCM 流入: ${pcmCount} 块 (${(pcmCount * 0.1).toFixed(0)}s 音频)`)
    }
    // buf 是 ArrayBuffer(16kHz Float32);wake-probe 每块 1600 样本 = 0.1s
    const samples = new Float32Array(buf)
    stream.acceptWaveform({ samples, sampleRate: 16000 })

    // 尽可能多地解码(可能有多个就绪帧)
    while (spotter.isReady(stream)) {
      spotter.decode(stream)
    }

    const result = spotter.getResult(stream)
    if (result && result.keyword && result.keyword.trim()) {
      const keyword = result.keyword.trim()
      const now = Date.now()
      if (now - lastHitTs >= COOLDOWN_MS) {
        lastHitTs = now
        log(`命中: "${result.keyword}"`)
        post({ type: 'hit', keyword })
      }
      // 命中后重置流,清掉残余状态,避免同一词重复触发
      try { spotter.reset(stream) } catch (e) { log('WARN: reset(stream) 失败: ' + (e && e.message || e)) }
    }
  } catch (e) {
    // 单块处理失败不应拖垮子进程;静默记日志继续
    log(`feedPcm 异常: ${e && e.message || e}`)
  }
}

// ─── 消息分发 ───
parentPort.on('message', (event) => {
  // utilityProcess 的 message 事件 payload 在 event.data 里(Electron 28+),
  // 旧版直接是消息对象。两种都兼容。
  const msg = (event && event.data) ? event.data : event
  if (!msg || typeof msg !== 'object') return
  // 分发兜底：init/feedPcm 内部已各自 try/catch，这里防的是未预见路径的抛错
  // 杀死子进程（无重启，唤醒词整会话失效）。
  try {
    if (msg.type === 'init') init(msg)
    else if (msg.type === 'pcm') feedPcm(msg.buf)
  } catch (e) {
    fail(`消息处理异常(${msg.type}): ${e && e.message || e}`)
  }
})

log('kws-process 启动,等待 init')
