// 测试：引擎返回的 rawContent 必须是未清洗原文的逐轮累积——
// "标记在引擎返回前被剥掉、协议副作用静默饿死"事故类（docs/solutions/logic-errors/
// llm-reply-protocol-markers-leaked-into-response-event.md 的汇合点修复，二轮评审 #2）。
//
// 用合成客户端（绕过网络，见 test-llm-stream-reasoning.js 同款）驱动两层：
//   1) streamOnce：rawContent=原始流文本，content=清洗后（事故发生的那一层）；
//   2) callLLM：rawAllContent 累积器与 allContent 锁步，rawContent 带标记、content 干净；
//   3) 汇合点 finalizeEngineTurnResult：markers 从 raw 解析、response 从 content 派生。
// 注意：_streamOnceForTest 注入会替换掉被测的清洗层，测不到本事故类——必须走 client 注入。
// Run: node src/test-llm-raw-content.js
import assert from 'node:assert/strict'
import { streamOnce, callLLM, _setClientForTest, _clearClientForTest } from './llm.js'
import { finalizeEngineTurnResult } from './runtime/markers.js'

function fakeClient(deltas) {
  const chunks = deltas.map(d => ({ choices: [{ delta: d }] }))
  return { chat: { completions: { create: async () => chunks } } }
}

const RAW = [
  '<think>内部推演：用户在问灯板状态</think>',
  '[MOOD: focused]',
  '灯板离线了，当前颜色卡在白色。',
  '[SET_TASK: 排查灯板离线]',
].join('\n')
const CLEAN = '灯板离线了，当前颜色卡在白色。'

// ── 1) streamOnce 层：raw passthrough（事故层）────────────────────────────────
{
  const r = await streamOnce({
    messages: [{ role: 'user', content: '现在什么情况' }],
    toolSchemas: [],
    client: fakeClient([{ content: RAW }]),
  })
  assert.ok(r.rawContent.includes('[MOOD: focused]'), 'streamOnce rawContent 必须保留原始标记')
  assert.ok(r.rawContent.includes('<think>'), 'streamOnce rawContent 必须保留 think')
  assert.equal(r.content, CLEAN, 'streamOnce content 仍是清洗后正文（后台调用方契约）')
}

// ── 2) callLLM 层：累积器锁步（raw 带标记 / content 干净）────────────────────
// callLLM 不透传 client 参数，用全局 _setClientForTest 注入（优先级高于激活检查）。
{
  _setClientForTest(fakeClient([{ content: RAW }]))
  try {
    const r = await callLLM({
      systemPrompt: 'test',
      messages: [{ role: 'user', content: '现在什么情况' }],
      tools: [],
      mustReply: false,
    })
    assert.ok(String(r.rawContent).includes('[SET_TASK: 排查灯板离线]'),
      'callLLM rawContent 必须累积原始标记（回归点：曾取自已清洗的 allContent）')
    assert.equal(r.content, CLEAN, 'callLLM content 保持干净')

    // ── 3) 汇合点：markers 从 raw，response 从 content ─────────────────────────
    const { markers, response } = finalizeEngineTurnResult(r)
    assert.equal(markers.mood, 'focused', '汇合点从 rawContent 解析 MOOD')
    assert.equal(markers.setTask, '排查灯板离线', '汇合点从 rawContent 解析 SET_TASK')
    assert.equal(response, CLEAN, 'response 从 content 派生，无标记')
  } finally {
    _clearClientForTest()
  }
}

// ── 4) 多轮拼接：response 绝不从 raw 派生（中段旁白防护）────────────────────
{
  _setClientForTest(fakeClient([{ content: '让我查一下相关资料。\n第一段结论。' }, { content: '让我再确认一次。\n第二段结论。' }]))
  try {
    const r = await callLLM({
      systemPrompt: 'test',
      messages: [{ role: 'user', content: '总结一下' }],
      tools: [],
      mustReply: false,
    })
    // 注意：第二轮的旁白前缀在 content 里同样存在（per-round sanitize 只剥文本开头的
    // loose prelude——两段以 '\n' 拼接后整串重洗会漏中段，这正是 response 必须来自
    // per-round 清洗的 content、而非 raw 的原因）。此处只断言契约方向：
    assert.ok(String(r.rawContent).includes('让我查一下'), 'raw 保留旁白原文')
    assert.equal(finalizeEngineTurnResult(r).response, r.content, 'response === 清洗后的 content（逐字节）')
  } finally {
    _clearClientForTest()
  }
}

console.log('test-llm-raw-content passed')
