// xz 系列工具 executor：包装本机 xz-calendar / xz-notes CLI。
// 复用 run_cli 已验证的安全执行核 execCommandNoShell（spawn(shell:false)，
// argv 原样直传，; $() 反引号等都是字面量，杜绝注入）。
//
// 开关在两层生效：
//   1) 注入层 tool-router.selectTools：isXzToolsEnabled() 为 false 时不注入工具
//   2) 执行层（此处）：即便被 find_tool 动态装载或 ActionLog 保活带进来，也先查开关
import { isXzToolsEnabled } from '../../config.js'
import { execCommandNoShell } from './shell.js'

// 二进制解析：env 优先（允许用户指向任意绝对路径），否则走 PATH。
// 不把本机绝对路径写进源码（分发到其他机器会 ENOENT，且泄露维护者目录）。
function resolveXzCalendarBin() {
  return process.env.XZ_CALENDAR_CLI || 'xz-calendar'
}
function resolveXzNotesBin() {
  return process.env.XZ_NOTES_CLI || 'xz-notes'
}

// command（位置子命令，如 "appointment create"）按空白拆成 argv 前缀，args 追加在后。
function buildArgv(command, args) {
  const cmd = String(command || '').trim()
  const parts = cmd ? cmd.split(/\s+/) : []
  const rest = Array.isArray(args) ? args.map(a => String(a)) : []
  return [...parts, ...rest]
}

function disabled(tool) {
  return JSON.stringify({ ok: false, tool, error: 'xz 工具未启用（设置→高级功能）' }, null, 2)
}

export async function execXzCalendar({ command, args } = {}, context = {}) {
  if (!isXzToolsEnabled()) return disabled('xz_calendar')
  const bin = resolveXzCalendarBin()
  return await execCommandNoShell({ bin, args: buildArgv(command, args) }, context)
}

export async function execXzNotes({ command, args } = {}, context = {}) {
  if (!isXzToolsEnabled()) return disabled('xz_notes')
  const bin = resolveXzNotesBin()
  return await execCommandNoShell({ bin, args: buildArgv(command, args) }, context)
}

// 不可逆写操作检测：这些 command 有副作用且不可撤销，需要用户 confront 确认后才执行。
// 返回 { irreversible: true, label } 或 { irreversible: false }。
// label 用于确认卡片的摘要文案。
const XZ_IRREVERSIBLE_PATTERNS = [
  { tool: 'xz_calendar', re: /^appointment\s+(create|cancel)\b/i, label: '创建/取消预约' },
  { tool: 'xz_calendar', re: /^(appointment\s+)?mark-paid\b/i, label: '缴费状态变更' },
  { tool: 'xz_notes', re: /^note\s+(confirm|reject)\b/i, label: '笔记确认/拒绝' },
]

export function checkXzIrreversible(toolName, command) {
  const cmd = String(command || '').trim()
  for (const p of XZ_IRREVERSIBLE_PATTERNS) {
    if (p.tool === toolName && p.re.test(cmd)) {
      return { irreversible: true, label: p.label }
    }
  }
  return { irreversible: false }
}
