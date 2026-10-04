// 测试：streamOnce 对推理流的 mode 路由（修复"TTS 把思考过程读出来"）
//
// 原事故：MiniMax-M3 经 OpenAI 兼容接口把推理以 <think>…</think> 形式流在 content 里
// （非独立 reasoning 字段），旧版"字段切换早关 think"逻辑会误关，把后续推理当正文
// (mode:'text') 送进 TTS。v2.2.120 Responses 形状下：<think> 内联仍可能出现在
// output_text.delta（模型自由文本），独立推理走 response.reasoning_text.delta 通道。
// 本测试断言两条通道都正确路由：内联 think → mode:'think'，reasoning 通道 → mode:'think'，
// 正文 → mode:'text'，正文流零推理泄漏。
// Run: node src/test-llm-stream-reasoning.js
import assert from 'node:assert/strict'
import { streamOnce } from './llm.js'

// 合成 Responses 客户端：responses.create 返回事件数组（for-await 可迭代）。
// textDeltas → output_text.delta（模型自由文本，可能含内联 <think>）；
// reasoningDeltas → reasoning_text.delta（独立推理通道）。
function fakeResponsesClient({ textDeltas = [], reasoningDeltas = [] } = {}) {
  let seq = 0
  const events = [
    ...reasoningDeltas.map(delta => ({ type: 'response.reasoning_text.delta', delta, sequence_number: ++seq })),
    ...textDeltas.map(delta => ({ type: 'response.output_text.delta', delta, sequence_number: ++seq })),
    {
      type: 'response.completed',
      sequence_number: ++seq,
      response: { output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    },
  ]
  return { responses: { create: async () => events } }
}

// 把 onStream 事件序列折叠成 [{mode, text}]：mode 取最近一次 start.mode
function chunkModes(events) {
  let cur = null
  const out = []
  for (const ev of events) {
    if (ev.event === 'start') cur = ev.mode
    else if (ev.event === 'end') cur = null
    else if (ev.event === 'chunk') out.push({ mode: cur, text: ev.text })
  }
  return out
}

async function run(client) {
  const events = []
  // 用 client 参数注入合成客户端（绕过网络 + 绕过全局 _clientOverride，无并行污染）
  await streamOnce({
    messages: [{ role: 'user', content: '推导 13×17' }],
    toolSchemas: [],
    onStream: e => events.push(e),
    client,
  })
  return chunkModes(events)
}

// ── 用例 1：minimax 式（<think> 内联在正文增量里）──────────────────────────────
// Responses 形状下的契约：内联 <think> 块由流式 sanitizer 缓冲并在闭合后剥除——
// 推理内容既不进 mode:'text'（TTS 零泄漏，回归点：旧版无换行 passthrough 会把
// ' me to calculate' 直接送进正文流被朗读），也不要求路由 mode:'think'
//（think 流可视化由独立 reasoning 通道承担，见用例 2）。
{
  const modes = await run(fakeResponsesClient({
    textDeltas: [
      '<think>The user is asking',
      ' me to calculate',
      ' 13*17.',
      '</think>221',
      '.',
    ],
  }))

  const textText = modes.filter(m => m.mode === 'text').map(m => m.text).join('')

  // 回归核心断言：正文流只含回答，推理块被完整剥离
  assert.equal(textText, '221.', '正文流只应含回答：' + textText)
  const leaked = modes.find(m => m.text.includes('calculate') || m.text.includes('<think'))
  assert.ok(!leaked, '任何 mode 的流式增量都不得含推理内容/<think 标记：' + JSON.stringify(leaked))
  console.log('✅ 用例1 minimax 内联 <think>：推理块剥离，正文零泄漏')
}

// ── 用例 2：Responses 独立推理通道回归守护 ──────────────────────────────────
// 旧 DeepSeek reasoning_content 字段式在 Responses 协议下对应独立 reasoning_text.delta
// 通道：推理必须路由到 think、不得进入正文流
{
  const modes = await run(fakeResponsesClient({
    reasoningDeltas: ['Reasoning step 1.', 'Reasoning step 2.'],
    textDeltas: ['Final answer.'],
  }))

  const thinkText = modes.filter(m => m.mode === 'think').map(m => m.text).join('')
  const textText = modes.filter(m => m.mode === 'text').map(m => m.text).join('')

  assert.ok(thinkText.includes('step 2'), '独立推理通道应全在 think：' + thinkText)
  assert.equal(textText, 'Final answer.', '正文应落到 text：' + textText)
  assert.ok(!textText.includes('Reasoning'), '正文流不得含推理')
  console.log('✅ 用例2 Responses reasoning 通道：推理→think / 正文→text，零泄漏')
}

console.log('\n全部通过 ✔')
