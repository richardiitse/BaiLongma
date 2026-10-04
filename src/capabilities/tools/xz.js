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

// 不可逆写操作检测（#12 修复：allowlist 模式）。
// 临床写工具安全默认是"确认一切非已知读命令"——denylist 无法跟上 CLI 演进。
// 枚举已知 READ 命令（无副作用），其余命令默认 irreversible:true（需确认）。
// 返回 { irreversible: true, label } 或 { irreversible: false }。
const XZ_READ_COMMANDS = [
  /^today\b/i,
  /^upcoming\b/i,
  /^overdue\b/i,
  /^(\w+\s+)?list\b/i,        // appointment list / client list / note list / bare list 等
  /^payment-summary\b/i,
  /^capabilities\b/i,
  /^help\b/i,
  /^doctor\b/i,
  /^context\b/i,              // xz_notes context appointment（只读）
  /^agent\s+(chat|test)\b/i,  // agent chat/test 是只读交互
  /^agent-write\s+audit\s+(show|list)\b/i,  // 审计查看只读
  /^history\b/i,
  /^payments\b/i,             // payment 查询（非 mark-paid）
  /^manifest\b/i,
  /^export-reflection\b/i,
  /^backup\s+verify\b/i,
  /^safety\s+(consent\s+)?(list|audit)\b/i,
]

export function checkXzIrreversible(toolName, command) {
  const cmd = String(command || '').trim()
  // allowlist：匹配已知 READ 命令 → 可逆（不确认）
  for (const re of XZ_READ_COMMANDS) {
    if (re.test(cmd)) return { irreversible: false }
  }
  // 其余命令默认不可逆（需确认）——写操作、更新、删除、创建等
  return { irreversible: true, label: `${toolName} ${cmd.split(/\s+/)[0] || ''}` }
}
