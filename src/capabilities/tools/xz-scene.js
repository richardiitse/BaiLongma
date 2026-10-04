// xz-scene.js — xz CLI 输出 → Scene-Shell surface 投影层。
//
// 职责：把 xz_calendar / xz_notes 的 CLI stdout 解析成结构化 surface data，
// 供 core（index.js 的 projectXzSurfaceForTurn）直接投影成 Scene 卡片。
// 不经 Agent 逐字段拼 surface——确定性查询由 core 直投，仿天气模式 A。
//
// 先例：software-install-scene.js（独立投影层 + surfaceId 函数）。
// surface 只含语义数据（kind/data/intent），不指定像素/位置/尺寸（SCENE-PROTOCOL.md §5.3）。

import { config } from '../../config.js'
import crypto from 'crypto'

// ── 脱敏：redactMode 开启时，来访者姓名 → 代号（C-{sha256 前8位 hex}）────
// #11 修复：从 4 位十进制（10000 桶，~118 人碰撞）改为 sha256 前 8 位 hex（~4 亿桶）。
// 代号按姓名哈希生成，同一人多次投影代号一致。Agent 上下文不脱敏（工具结果原样）。
const _redactCache = new Map()
function redactName(name) {
  if (!config.xzRedactMode) return name
  const key = String(name || '').trim()
  if (!key) return key  // 空名不脱敏（避免 C-0000 碰撞）
  if (!_redactCache.has(key)) {
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)
    _redactCache.set(key, 'C-' + hash)
  }
  return _redactCache.get(key)
}

// #3 修复：PII 正则——脱敏 body 中的电话号码和邮箱（不止 title）。
const PII_PATTERNS = [
  { re: /1[3-9]\d{9}/g, replace: '[电话]' },                    // 11 位手机号
  { re: /\d{3}[-\s]?\d{4}[-\s]?\d{4}/g, replace: '[电话]' },    // 带分隔符电话
  { re: /[\w.+-]+@[\w.-]+\.\w+/g, replace: '[邮箱]' },          // 邮箱
]

function redactPII(text) {
  if (typeof text !== 'string') return text
  let result = text
  for (const p of PII_PATTERNS) {
    result = result.replace(p.re, p.replace)
  }
  return result
}

// 递归遍历 surface data，把疑似姓名的 title 字段 + body 中 PII 脱敏
function applyRedact(surface) {
  if (!config.xzRedactMode || !surface) return surface
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(walk)
    const out = { ...obj }
    // title 字段疑似来访者姓名（text kind 的 title 常是名字）→ 脱敏
    if (typeof out.title === 'string' && out.title.length <= 20 && !out.title.includes('📋') && !out.title.includes('💰') && !out.title.includes('📝')) {
      out.title = redactName(out.title)
    }
    // #3 修复：body 字段脱敏 PII（电话/邮箱）+ 可能含的来访者姓名片段
    if (typeof out.body === 'string') {
      out.body = redactPII(out.body)
    }
    if (out.data) out.data = walk(out.data)
    if (out.children) out.children = out.children.map(walk)
    return out
  }
  return walk(surface)
}

// ── surface id 生成（按 语义，稳定可复用）──────────────────────────────
// 同一天调 today 两次 → 相同 id → 幂等 morph，不重建卡片。
export function xzSurfaceId(command = '') {
  const cmd = String(command || '').trim().toLowerCase()
  const today = new Date().toISOString().slice(0, 10)         // YYYY-MM-DD
  const month = today.slice(0, 7)                              // YYYY-MM
  if (cmd === 'today' || cmd.startsWith('today')) return `xz-today-${today}`
  if (cmd.startsWith('upcoming')) return 'xz-upcoming'
  if (cmd.startsWith('overdue')) return 'xz-overdue'
  if (cmd.includes('payment-summary') || cmd.includes('mark-paid')) return `xz-payments-${month}`
  if (cmd.startsWith('client list')) return 'xz-clients'
  if (cmd.startsWith('appointment list')) return `xz-appointments-${today}`
  return `xz-result-${today}`  // 兜底：其他查询用日期维度
}

// ── stdout 解析：先 JSON，失败文本降级 ─────────────────────────────────
// xz-notes 输出恒为 JSON；xz-calendar 写操作支持 --json，但查询类（today/list）
// 可能输出文本表格。解析器要同时处理两种。
function parseStdout(stdout = '') {
  const raw = String(stdout || '').trim()
  if (!raw) return { ok: false, empty: true }
  // 尝试 JSON
  try {
    const parsed = JSON.parse(raw)
    return { ok: true, json: parsed }
  } catch { /* 不是 JSON，走文本降级 */ }
  return { ok: false, text: raw }
}

// ── 安全截取：文本过长时截断，surface 不堆太多 ─────────────────────────
function clip(text, max = 200) {
  const s = String(text || '').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ── per-command surface 构建器 ─────────────────────────────────────────
// 每个构建器接收解析后的数据，返回 { kind, data, intent } 或 null（无法投影）。
// intent 策略：查询结果用 inform（常规信息），不抢焦点。

// today / upcoming / overdue / appointment list → 今日/列表类
function buildListSurface(parsed, command) {
  // JSON 路径：期望 { appointments: [...] } 或 { data: [...] } 或数组
  if (parsed.ok && parsed.json) {
    const j = parsed.json
    const items = Array.isArray(j) ? j
      : Array.isArray(j.appointments) ? j.appointments
      : Array.isArray(j.data) ? j.data
      : Array.isArray(j.items) ? j.items
      : null
    if (items && items.length > 0) {
      const children = items.slice(0, 10).map((item, i) => {
        const time = item.start || item.time || item.appointment_start || item.date || ''
        const name = item.client_name || item.client || item.name || item.lookup || `项目 ${i + 1}`
        const status = item.status || item.payment_status || ''
        const dur = item.duration ? `${item.duration}min` : ''
        const body = [time, dur, status].filter(Boolean).join(' · ')
        return { id: `xz-item-${i}`, kind: 'text', data: { title: String(name), body: body || '—' } }
      })
      return {
        kind: 'stack',
        data: {
          children,
          gap: 'sm',
        },
        intent: 'inform',
      }
    }
    // JSON 但空列表
    return {
      kind: 'text',
      data: { title: '查询结果', body: '暂无记录' },
      intent: 'inform',
    }
  }
  // 文本路径：直接把 stdout 作为 body（已截断）
  if (parsed.text) {
    return {
      kind: 'text',
      data: { title: command, body: clip(parsed.text, 400) },
      intent: 'inform',
    }
  }
  // 空输出
  if (parsed.empty) {
    return {
      kind: 'text',
      data: { title: '查询结果', body: '暂无记录' },
      intent: 'inform',
    }
  }
  return null
}

// payment-summary / payment 相关 → 含 metric 数值 + 明细
function buildPaymentSurface(parsed, command) {
  if (parsed.ok && parsed.json) {
    const j = parsed.json
    // 尝试提取总额（多种可能字段名）
    const total = j.total || j.total_amount || j.amount || j.summary?.total
    const currency = j.currency || '元'
    const items = Array.isArray(j.payments) ? j.payments
      : Array.isArray(j.items) ? j.items
      : Array.isArray(j.data) ? j.data
      : null
    const children = []
    if (typeof total === 'number' || typeof total === 'string') {
      children.push({
        id: 'xz-payment-total',
        kind: 'metric',
        data: { label: '待缴费总额', value: total, unit: currency },
      })
    }
    if (items && items.length > 0) {
      const detailChildren = items.slice(0, 8).map((item, i) => ({
        id: `xz-payment-${i}`,
        kind: 'text',
        data: {
          title: item.client_name || item.client || item.name || `记录 ${i + 1}`,
          body: [item.amount ? `${item.amount}${currency}` : '', item.status || item.payment_status || ''].filter(Boolean).join(' · '),
        },
      }))
      children.push(...detailChildren)
    }
    if (children.length > 0) {
      return { kind: 'stack', data: { children, gap: 'sm' }, intent: 'inform' }
    }
  }
  // 文本降级
  if (parsed.text) {
    return { kind: 'text', data: { title: '缴费汇总', body: clip(parsed.text, 400) }, intent: 'inform' }
  }
  return null
}

// client list → 来访者列表
function buildClientListSurface(parsed, command) {
  if (parsed.ok && parsed.json) {
    const j = parsed.json
    const items = Array.isArray(j) ? j
      : Array.isArray(j.clients) ? j.clients
      : Array.isArray(j.data) ? j.data
      : null
    if (items && items.length > 0) {
      const children = items.slice(0, 10).map((item, i) => ({
        id: `xz-client-${i}`,
        kind: 'text',
        data: {
          title: item.name || item.client_name || `来访者 ${i + 1}`,
          body: [item.phone, item.session_type, item.source].filter(Boolean).join(' · ') || '—',
        },
      }))
      return { kind: 'stack', data: { children, gap: 'sm' }, intent: 'inform' }
    }
  }
  if (parsed.text) {
    return { kind: 'text', data: { title: '来访者列表', body: clip(parsed.text, 400) }, intent: 'inform' }
  }
  return null
}

// ── per-command 映射表 ────────────────────────────────────────────────
const XZ_SURFACE_BUILDERS = [
  { match: /^payment-summary|payment_summary|mark-paid/i, build: buildPaymentSurface },
  { match: /^client\s+list/i, build: buildClientListSurface },
  { match: /^today|upcoming|overdue|appointment\s+list/i, build: buildListSurface },
]

// ── 总入口：解析 stdout 并构建 surface ─────────────────────────────────
// 返回 { id, kind, data, intent } 或 null（无法投影或输出不匹配任何构建器）。
export function buildXzSurface(command = '', stdout = '') {
  const cmd = String(command || '').trim()
  const parsed = parseStdout(stdout)
  for (const builder of XZ_SURFACE_BUILDERS) {
    if (builder.match.test(cmd)) {
      const surface = builder.build(parsed, cmd)
      if (surface) {
        return applyRedact({ id: xzSurfaceId(cmd), ...surface })
      }
      return null
    }
  }
  // 未匹配专用构建器：文本降级（JSON 则提取可读摘要）
  if (parsed.ok && parsed.json) {
    const text = JSON.stringify(parsed.json, null, 2)
    return applyRedact({ id: xzSurfaceId(cmd), kind: 'text', data: { title: cmd, body: clip(text, 400) }, intent: 'inform' })
  }
  if (parsed.text) {
    return applyRedact({ id: xzSurfaceId(cmd), kind: 'text', data: { title: cmd, body: clip(parsed.text, 400) }, intent: 'inform' })
  }
  return null
}

// （#9 修复：删除死代码 projectXzQuerySurface/getSceneStore/sceneStoreSafeSet/_sceneStore。
// index.js 的 projectXzSurfaceForTurn 已直接用 sceneStore.set 正确投影，这些辅助函数从未被调用且 sceneStoreSafeSet 永远 no-op。）

// ── 临床工作台：复合 surface（今日排班 + 待缴费 + 待编译笔记）─────────
// 供 index.js 在 TICK 心跳时调用刷新。并发调三个 CLI，组装成一个 stack。
// surface id 固定 'xz-workbench'，intent=ambient（角落低调，不抢焦点）。
// OQ2 解决：刷新频率跟随 TICK 节奏（ticker.js 的 L2 自适应间隔），不额外加节流。
export const WORKBENCH_SURFACE_ID = 'xz-workbench'

export async function buildWorkbenchSurface({ execCalendar, execNotes }) {
  const today = new Date().toISOString().slice(0, 10)
  // 并发调三个查询，任一失败该区域显示「暂时不可用」
  const [todayRes, payRes, notesRes] = await Promise.allSettled([
    execCalendar ? execCalendar({ command: 'today', args: ['--json'] }, {}) : Promise.resolve('{"ok":false}'),
    execCalendar ? execCalendar({ command: 'payment-summary', args: ['--json'] }, {}) : Promise.resolve('{"ok":false}'),
    execNotes ? execNotes({ command: 'context appointment', args: ['--limit', '5', '--json'] }, {}) : Promise.resolve('{"ok":false}'),
  ])

  const children = []

  // 区域 1：今日排班（标题卡 + 预约明细）
  const todayOk = todayRes.status === 'fulfilled' && envelopeOk(todayRes.value)
  const todaySurface = todayOk ? buildXzSurface('today', safeParseStdout(todayRes.value)) : null
  const todayItems = todaySurface?.data?.children || []
  const todayCount = todayItems.length
  const todayBody = !todayOk ? '暂时不可用'
    : todayCount > 0 ? todayItems.map(c => `${c.data.title} ${c.data.body || ''}`.trim()).join('\n')
    : '暂无预约'
  children.push({ id: 'wb-today', kind: 'text', data: { title: `📋 今日排班 (${todayCount})`, body: clip(todayBody, 300) } })

  // 区域 2：待缴费
  const payOk = payRes.status === 'fulfilled' && envelopeOk(payRes.value)
  const paySurface = payOk ? buildXzSurface('payment-summary', safeParseStdout(payRes.value)) : null
  if (paySurface && paySurface.data.children?.some(c => c.kind === 'metric')) {
    const metric = paySurface.data.children.find(c => c.kind === 'metric')
    children.push({ id: 'wb-payment', kind: 'metric', data: { ...metric.data, label: '💰 ' + metric.data.label } })
  } else {
    children.push({ id: 'wb-payment', kind: 'metric', data: { label: '💰 待缴费', value: payOk ? '—' : '暂时不可用' } })
  }

  // 区域 3：待编译笔记
  const notesOk = notesRes.status === 'fulfilled' && envelopeOk(notesRes.value)
  const notesText = notesOk ? safeParseStdout(notesRes.value) : ''
  const notesSummary = !notesOk ? '暂时不可用'
    : notesText ? clip(notesText.split('\n').filter(Boolean).slice(0, 3).join('；'), 120)
    : '暂无'
  children.push({ id: 'wb-notes', kind: 'text', data: { title: '📝 待编译笔记', body: notesSummary } })

  return applyRedact({
    id: WORKBENCH_SURFACE_ID,
    kind: 'stack',
    data: { children, gap: 'md' },
    intent: 'ambient',
  })
}

// 从工具信封字符串中提取 stdout（execXzCalendar 返回的是 JSON 信封）
function safeParseStdout(envelopeStr) {
  try {
    const env = typeof envelopeStr === 'string' ? JSON.parse(envelopeStr) : envelopeStr
    if (env && env.ok === false) return ''  // CLI 失败 → 空输出
    return env?.stdout || ''
  } catch {
    return String(envelopeStr || '')
  }
}

// 检查工具信封是否成功（ok !== false）
function envelopeOk(envelopeStr) {
  try {
    const env = typeof envelopeStr === 'string' ? JSON.parse(envelopeStr) : envelopeStr
    return !!(env && env.ok !== false)
  } catch {
    return false
  }
}

