// xz 文档动态加载器：从 xz-calender / xz-notes 项目目录读取 SKILL.md / CLI 合约，
// 生成工具 description 和 context block，替代 schemas/xz.js 里的硬编码。
//
// 设计：
//   - lazy init：首次调用时加载，缓存在 module 变量
//   - fallback：文件不存在或 CLI 不可用时返回 null，调用方回退到硬编码
//   - 路径反推：从 .env 的 XZ_*_CLI 绝对路径向上查找项目根（Package.swift / package.json）
//   - 不在 xz 开关关闭时加载（调用方负责前置检查）
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// 从 CLI 二进制路径反推项目根目录。
// xz-calendar: 向上找 Package.swift
// xz-notes: 向上找 package.json
function findProjectRoot(binPath, marker) {
  if (!binPath) return null
  let dir = path.dirname(binPath)
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(path.join(dir, marker))) return dir
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function tryReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// 从 cli-contract.md 提取子命令概要。
// cli-contract.md 用 `## Section` 分组，命令以行内代码 `xz-calendar <command>` 出现。
// 提取所有 `xz-calendar ` 后面的命令名（如 client, appointment, today, schedule）。
function extractCommandSummary(contractText) {
  if (!contractText) return ''
  const cmds = new Set()
  // 匹配 `xz-calendar <command>` 或行内代码里的命令
  const re = /`xz-calendar\s+([a-z][a-z-]+(?:\s+[a-z][a-z-]+)?)/gi
  let m
  while ((m = re.exec(contractText)) !== null) {
    cmds.add(m[1])
    if (cmds.size >= 25) break
  }
  // 也匹配 ## 标题里的命令名
  const re2 = /^##\s+([A-Z][a-z]+)/gm
  while ((m = re2.exec(contractText)) !== null) {
    cmds.add(m[1].toLowerCase())
    if (cmds.size >= 25) break
  }
  return [...cmds].join(', ')
}

// 从 capabilities --json 的输出提取能力名列表。
// capabilities v2 格式是嵌套对象 { data: { capabilities: { features: { ... } } } }
// 提取 features 和 materialKinds 等顶层键作为能力概要。
function extractCapabilityNames(jsonText) {
  try {
    const data = JSON.parse(jsonText)
    const caps = data?.data?.capabilities || data?.capabilities || {}
    const features = Object.keys(caps.features || {})
    const materialKinds = caps.materialKinds || []
    const all = [...features, ...materialKinds.map(k => `material:${k}`)]
    if (all.length > 0) return all.slice(0, 20).join(', ')
  } catch {}
  return ''
}

// --- xz-calendar 文档 ---

let _calendarCache = undefined // undefined = 未加载, null = 加载失败, object = 成功

export function getXzCalendarDocs() {
  if (_calendarCache !== undefined) return _calendarCache
  try {
    const bin = process.env.XZ_CALENDAR_CLI
    const root = findProjectRoot(bin, 'Package.swift')
    if (!root) { _calendarCache = null; return null }

    const skillPath = path.join(root, '.agents', 'skills', 'xz-calendar-cli', 'SKILL.md')
    const contractPath = path.join(root, '.agents', 'skills', 'xz-calendar-cli', 'references', 'cli-contract.md')

    const skillText = tryReadFile(skillPath)
    const contractText = tryReadFile(contractPath)

    if (!skillText && !contractText) { _calendarCache = null; return null }

    const cmdSummary = extractCommandSummary(contractText)
    const description = `本机心理咨询日历 CLI xz-calendar 的入口。需在「设置→高级功能」启用 xz 工具。\n\n子命令：${cmdSummary || '见 cli-contract.md'}\n\ncommand 用空格连接（如 "appointment create"），args 是额外参数。写操作支持 --json。`

    _calendarCache = {
      description,
      contextBlock: skillText || contractText || '',
    }
  } catch {
    _calendarCache = null
  }
  return _calendarCache
}

// --- xz-notes 文档 ---

let _notesCache = undefined

export function getXzNotesDocs() {
  if (_notesCache !== undefined) return _notesCache
  try {
    const bin = process.env.XZ_NOTES_CLI
    const root = findProjectRoot(bin, 'package.json')
    if (!root) { _notesCache = null; return null }

    const agentsMdPath = path.join(root, 'AGENTS.md')
    const agentsText = tryReadFile(agentsMdPath)

    // 跑 capabilities --json 提取能力列表
    let capNames = ''
    if (bin) {
      try {
        // spawnSync(shell:false) 避免 shell 注入——与 execCommandNoShell 同款安全模型。
        const r = spawnSync(bin, ['capabilities', '--json'], { encoding: 'utf-8', timeout: 5000 })
        if (r.status === 0 && !r.error) capNames = extractCapabilityNames(r.stdout || '')
      } catch {}
    }

    if (!agentsText && !capNames) { _notesCache = null; return null }

    const description = `本机临床笔记 CLI xz-notes 的入口。需在「设置→高级功能」启用 xz 工具。\n\n能力：${capNames || '见 capabilities --json'}\n\ncommand 用空格连接（如 "note compile"），args 是额外参数。输出恒为 JSON。`

    _notesCache = {
      description,
      contextBlock: agentsText || '',
    }
  } catch {
    _notesCache = null
  }
  return _notesCache
}

// 测试用：重置缓存
export function _resetCacheForTest() {
  _calendarCache = undefined
  _notesCache = undefined
}
