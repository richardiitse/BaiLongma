// xz-scene.js — xz CLI 输出 → Scene-Shell surface 投影层。
//
// 职责：把 xz_calendar / xz_notes 的 CLI stdout 解析成结构化 surface data，
// 供 core（index.js 的 projectXzSurfaceForTurn）直接投影成 Scene 卡片。
// 不经 Agent 逐字段拼 surface——确定性查询由 core 直投，仿天气模式 A。
//
// 先例：software-install-scene.js（独立投影层 + surfaceId 函数）。
// surface 只含语义数据（kind/data/intent），不指定像素/位置/尺寸（SCENE-PROTOCOL.md §5.3）。

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
        return { id: xzSurfaceId(cmd), ...surface }
      }
      return null
    }
  }
  // 未匹配专用构建器：文本降级（JSON 则提取可读摘要）
  if (parsed.ok && parsed.json) {
    const text = JSON.stringify(parsed.json, null, 2)
    return { id: xzSurfaceId(cmd), kind: 'text', data: { title: cmd, body: clip(text, 400) }, intent: 'inform' }
  }
  if (parsed.text) {
    return { id: xzSurfaceId(cmd), kind: 'text', data: { title: cmd, body: clip(parsed.text, 400) }, intent: 'inform' }
  }
  return null
}

// ── core 直投入口：检测 xz 查询意图 → 调 CLI → 投影 ───────────────────
// 供 index.js 的 projectXzSurfaceForTurn 调用。
// 返回 { id, changed } 或 null（非 xz 查询 / CLI 失败 / 无 surface）。
export async function projectXzQuerySurface({ command, args, execFn }) {
  if (typeof execFn !== 'function') return null
  // 调 CLI（execXzCalendar / execXzNotes 已含 isXzToolsEnabled 门控）
  const resultStr = await execFn({ command, args }, {})
  // 解析工具信封 { ok, stdout, ... }
  let envelope
  try { envelope = JSON.parse(resultStr) } catch { return null }
  if (!envelope || envelope.ok === false) return null  // CLI 失败（ENOENT/非零退出）→ 不投影

  const surface = buildXzSurface(command, envelope.stdout)
  if (!surface) return null

  const { id, kind, data, intent } = surface
  const changed = sceneStoreSafeSet(id, { kind, data, intent })
  return { id, changed }
}

// 间接引用 sceneStore（避免循环依赖：xz-scene 不直接 import scene-store，
// 由调用方注入或用动态 import）。当前用懒加载模式。
let _sceneStore = null
async function getSceneStore() {
  if (_sceneStore) return _sceneStore
  const m = await import('../../scene/scene-store.js')
  _sceneStore = m.sceneStore
  return _sceneStore
}

function sceneStoreSafeSet(id, surface) {
  // 同步降级：如果 sceneStore 还没加载，返回 true（保守认为有变化）
  if (!_sceneStore) return true
  return _sceneStore.set(id, surface)
}
