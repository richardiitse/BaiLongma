// xz 系列工具 schema：本机 xz-calendar / xz-notes CLI 的专用入口。
// description 从 xz 项目的 SKILL.md / cli-contract.md / capabilities --json 动态加载
// （xz-loader.js），加载失败时回退到硬编码。
//
// 命令约定：command 是 CLI 的位置子命令（空格连接，如 "appointment create"），
// args 是额外 argv tokens，二者拼接后经 spawn(shell:false) 原样直传（不解释元字符）。
import { getXzCalendarDocs, getXzNotesDocs } from '../tools/xz-loader.js'

// 硬编码 fallback（加载器返回 null 时使用）
const FALLBACK_CALENDAR_DESC = '本机心理咨询日历 CLI xz-calendar 的入口（来访者/预约/排班/缴费/导入审阅）。需在「设置→高级功能」启用 xz 工具。command 用空格连接（如 "appointment create"），args 是额外参数。'
const FALLBACK_NOTES_DESC = '本机临床笔记 CLI xz-notes 的入口（归档/笔记编译/临床安全/存储加密）。需在「设置→高级功能」启用 xz 工具。command 用空格连接（如 "note compile"），args 是额外参数。'

function calendarDesc() {
  const docs = getXzCalendarDocs()
  return docs?.description || FALLBACK_CALENDAR_DESC
}

function notesDesc() {
  const docs = getXzNotesDocs()
  return docs?.description || FALLBACK_NOTES_DESC
}

export function buildXzSchemas() {
  return {
    xz_calendar: {
      type: 'function',
      function: {
        name: 'xz_calendar',
        description: calendarDesc(),
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'CLI 子命令，如 "appointment create"、"today"、"client list"。空串=无子命令。' },
            args: { type: 'array', items: { type: 'string' }, description: '额外 argv tokens，如 ["--client-id","<uuid>","--json"]。每个 token 原样直传 spawn，不经 shell。' },
          },
          required: ['command'],
        },
      },
    },
    xz_notes: {
      type: 'function',
      function: {
        name: 'xz_notes',
        description: notesDesc(),
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'CLI 子命令，如 "note compile"、"context appointment"、"doctor"。空串=无子命令。' },
            args: { type: 'array', items: { type: 'string' }, description: '额外 argv tokens，如 ["--archive-id","<id>"]。每个 token 原样直传 spawn。' },
          },
          required: ['command'],
        },
      },
    },
  }
}
