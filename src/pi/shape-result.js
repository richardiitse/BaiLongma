// Pi worker 'end' 消息 → runTurn 读取的引擎返回形状。
// 独立成纯模块（不 import config/executor 等重依赖）以便单元测试直接覆盖——
// worker 在系统 node 子进程，无法 import markers，故清洗在主进程这一侧完成。
import { sanitizeAssistantReplyForDelivery } from '../runtime/markers.js'

export function shapePiTurnResult(m) {
  const raw = m?.content || ''
  return {
    content: sanitizeAssistantReplyForDelivery(raw),
    rawContent: raw,
    toolResult: null,
    aborted: !!m?.aborted,
    delivered: !!m?.delivered,
  }
}
