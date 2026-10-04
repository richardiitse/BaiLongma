// 汇合点回归测试：runTurn 的 finalizeTurnReply（src/runtime/markers.js）必须保证——
//   1) response 事件正文绝不含 <think> / 协议标记 / loose internal prelude
//      （docs/solutions/logic-errors/llm-reply-protocol-markers-leaked-into-response-event.md 的事故不再可能回归）；
//   2) 协议副作用所需的 markers 从 rawContent 解析（引擎自行 sanitize 也不再饿死协议——
//      a0a4cc6 修复曾让 parseMarkers 只能看到已剥离文本，RECALL/MOOD 等副作用静默失效）；
//   3) 引擎缺 rawContent 的旧返回形状（中止路径等）回退 content，行为不劣化。
import assert from 'node:assert/strict'
import { finalizeTurnReply, finalizeEngineTurnResult, sanitizeAssistantReplyForDelivery } from './runtime/markers.js'
import { shapePiTurnResult } from './pi/shape-result.js'

// 事故形状：同一段正文同时携带 loose internal prelude、<think>、全部 5 种协议标记。
const incidentRaw = [
  '用户刚从"智谱官网"话题切到"三元里"话题，问"现在是什么情况"。',
  '让我想想最可能的意图。',
  '<think>结合上下文，他们可能是在问当前的整体状态。</think>',
  '灯板离线了，当前颜色卡在白色，没有设备连着。',
  '[MOOD: focused]',
  '[SET_TASK: 排查灯板离线]',
  '[RECALL: 灯板 历史状态]',
  '[CLEAR_TASK]',
  '[UPDATE_PERSONA: 更直接的报修风格]',
].join('\n')

// 1) 汇合点产出的 response 干净
const { markers, response } = finalizeTurnReply(incidentRaw)
assert.equal(
  response,
  '灯板离线了，当前颜色卡在白色，没有设备连着。',
  'response 剥掉 think、loose prelude、全部协议标记',
)

// 2) markers 从 rawContent 解析（当前生产代码曾做不到）
assert.equal(markers.mood, 'focused', 'MOOD 从 rawContent 提取')
assert.equal(markers.setTask, '排查灯板离线', 'SET_TASK 从 rawContent 提取')
assert.equal(markers.recall, '灯板 历史状态', 'RECALL 从 rawContent 提取')
assert.equal(markers.clearTask, true, 'CLEAR_TASK 从 rawContent 提取')
assert.equal(markers.updatePersona, '更直接的报修风格', 'UPDATE_PERSONA 从 rawContent 提取')

// 纵深防御：引擎已 sanitize 过的 content 再过一次汇合点也不变形（幂等）
assert.equal(
  sanitizeAssistantReplyForDelivery(response),
  response,
  'sanitize 幂等：干净正文再洗一次不变',
)

// 3) 无 rawContent 的旧返回形状：回退 content，只保证 delivery 干净
const legacy = finalizeTurnReply(sanitizeAssistantReplyForDelivery(incidentRaw))
assert.equal(legacy.response, '灯板离线了，当前颜色卡在白色，没有设备连着。', 'legacy content 兜底 sanitize')
assert.equal(legacy.markers.mood, null, 'legacy 路径解析不出标记（现状行为，不劣化）')

// 4) 空输入 / null 安全（中止路径 llmResult.content = ''）
const empty = finalizeTurnReply('')
assert.equal(empty.response, '', '空正文 → 空 response')
assert.equal(empty.markers.recall, null, '空正文 → 无标记')
assert.equal(finalizeTurnReply(undefined).response, '', 'undefined 不抛错')

// 5) 普通正文不误伤（不以协议前缀开头的正常内容原样通过）
const plain = finalizeTurnReply('用户画像可以从三个维度看：偏好、场景、限制。')
assert.equal(plain.response, '用户画像可以从三个维度看：偏好、场景、限制。', '正常正文原样通过')
assert.equal(plain.markers.mood, null, '正常正文无标记')

// 6) 汇合点入口 finalizeEngineTurnResult（引擎返回形状）：markers 取 raw、response 取 content
{
  const engine = { content: sanitizeAssistantReplyForDelivery(incidentRaw), rawContent: incidentRaw }
  const { markers, response } = finalizeEngineTurnResult(engine)
  assert.equal(markers.mood, 'focused', 'engine 形状：MOOD 从 rawContent 解析')
  assert.equal(markers.setTask, '排查灯板离线', 'engine 形状：SET_TASK 从 rawContent 解析')
  assert.equal(response, '灯板离线了，当前颜色卡在白色，没有设备连着。', 'engine 形状：response 从 content 派生')

  // 中段旁白防护：response 从 per-round 清洗的 content 派生，而非 raw 整串重洗
  const twoRounds = {
    content: '第一段结论。\n第二段结论。',
    rawContent: '让我查一下资料。\n第一段结论。\n让我再确认。\n第二段结论。',
  }
  assert.equal(
    finalizeEngineTurnResult(twoRounds).response,
    '第一段结论。\n第二段结论。',
    'response 只来自 content——raw 的中段旁白不得混入',
  )
}

// 7) pi 引擎返回形状 shapePiTurnResult（worker end 消息 → 引擎契约）
{
  const r = shapePiTurnResult({ content: incidentRaw, aborted: false, delivered: true })
  assert.equal(r.rawContent, incidentRaw, 'pi：rawContent 为 worker 原文')
  assert.equal(r.content, '灯板离线了，当前颜色卡在白色，没有设备连着。', 'pi：content 清洗后')
  const conv = finalizeEngineTurnResult(r)
  assert.equal(conv.markers.mood, 'focused', 'pi：汇合点解析出 MOOD')
  assert.equal(conv.response, '灯板离线了，当前颜色卡在白色，没有设备连着。', 'pi：response 干净')
}

// 8) 缺 rawContent 的旧返回形状（中止路径 / 占位返回）优雅降级
{
  const abort = finalizeEngineTurnResult({ content: '', toolResult: null, aborted: true, delivered: false })
  assert.equal(abort.response, '', '中止形状：空 response')
  assert.equal(abort.markers.recall, null, '中止形状：无标记')
  assert.equal(finalizeEngineTurnResult(undefined).response, '', 'undefined 不抛错')
  const legacy = finalizeEngineTurnResult({ content: sanitizeAssistantReplyForDelivery(incidentRaw) })
  assert.equal(legacy.response, '灯板离线了，当前颜色卡在白色，没有设备连着。', 'legacy：content 兜底干净')
  assert.equal(legacy.markers.mood, null, 'legacy：解析不出标记（现状行为，不劣化）')
}

console.log('test-turn-response-convergence passed')
