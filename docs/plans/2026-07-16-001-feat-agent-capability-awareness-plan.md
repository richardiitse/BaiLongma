---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
title: Agent 能力自感知 - Plan
date: 2026-07-16
deepened: 2026-07-16
---

# Agent 能力自感知 - Plan

## Goal Capsule

**目标：** 让 agent 在任何对话轮次都知道自己有哪些能力域（即使当前轮没注入对应工具），并能引导用户启用未开启的功能。

**产品权威：** 这是 Jarvis 核心交互体验的改进，源于用户发现 agent 无法自我报告能力边界，导致"你有没有 xz 工具"得到错误回答"没有"。

**阻塞项：** 无。所有技术路径已验证，现有架构支撑充分。

Product Contract unchanged.

---

## Problem Frame

Agent 的工具可见性完全依赖"当前轮关键词命中"。`selectTools()` 每轮根据消息正文的关键词匹配注入工具组，agent 永远看不到自己的完整能力目录。当用户问"你有哪些工具"时，agent 只看到当前轮匹配的工具（如 `capability_demo`），如实回答"没有 xz 工具"——即使开关开着、工具已注册。

根因不是代码 bug，而是架构层面的发现机制缺陷：agent 缺少一份"我知道自己有哪些能力"的自感知层。

---

## Requirements

*(Preserved from brainstorm Product Contract — see R1-R4 below in Implementation Units.)*

- **R1:** 能力清单注入（系统提示词层）——每轮注入极简能力概览，关闭的标注"（未启用）"
- **R2:** list_tools 提升可发现性——从 ADMIN_TOOLS 加宽触发条件
- **R3:** xz 工具迁移到 capability-registry——带 context workflow 块
- **R4:** 斜杠命令注册表——chat.js 硬编码改为可扩展注册表

---

## Key Technical Decisions

### KTD1: 能力清单数据源——扩展 `listCapabilities()` 增加 `enabled` 字段

`listCapabilities()` (`capability-registry.js:252`) 目前只返回静态元数据 `{id, label, summary, tools, triggers, hasContext}`，不调 `detect()`，无 `enabled` 字段。

**决策：** 给 `listCapabilities()` 增加可选 `enabled` 计算——对每个 capability 调用其 `detect(ctx)` 或一个轻量 `isEnabled()` 判定（registry 条目可声明一个 `isEnabled: () => boolean` 可选字段，省略时默认 true）。xz 条目的 `isEnabled` 就是 `isXzToolsEnabled()`。清单渲染时 `enabled: false` 的条目标注"（未启用）"。

**理由：** 系统提示词需要知道能力是否启用，而启用状态分散在各 config 开关里（`isXzToolsEnabled`、API slot 的 `slot.enabled`）。统一到 registry 的 `isEnabled` 字段比在 prompt.js 里逐个硬编码更可维护。

### KTD2: list_tools 输出截断——分类 + 描述截断

`execListTools` (`executor.js:484`) 目前返回全量未截断的工具列表（每个工具的完整 description），对上下文可能过大。

**决策：** 给 `execListTools` 增加截断：每条工具的 description 截断到 ~120 字符，并按 source（builtin/installed）分组。总数显示不变。

**理由：** `find_tool` 已有 200 字符截断和 8 条上限的先例。`list_tools` 被提升后会更高频调用，不截断会浪费 token。

### KTD3: xz 迁移保留 ActionLog 抑制 + find_tool 过滤

迁移 xz 到 registry 后，`suppressed` 集合防御（`tool-router.js:338-339`）和 `find_tool` 的 `XZ_HIDDEN` 过滤（`executor.js:543-545`）**不能删除**。

**决策：** 保留这两处防御代码不变，并**额外**在 `findCapabilitiesByQuery` 返回路径增加 xz 开关门。`capabilityToolsFor()` 的 `detect` 门控替代 `selectTools` 里的关键词+开关门，但 ActionLog keepalive（独立于 capability 注入路径）仍需要 `suppressed` 拦截。`find_tool` 有两条返回路径需要保护：工具名过滤（`XZ_HIDDEN`，已有）和 capability metadata（`findCapabilitiesByQuery` 返回的 `capabilities[]` 数组，当前无门控）。后者也必须按 `isXzToolsEnabled()` 过滤，否则关闭开关时 agent 仍能看到 xz 的 label/summary/workflow。

**理由：** `capabilityToolsFor` 只管当前轮的关键词注入，不管跨轮保活。删除 `suppressed` 会导致用户关掉开关后，上一轮调过的 xz 工具被 ActionLog 捞回。`findCapabilitiesByQuery` 的 metadata 泄露是 U3 迁移引入的新面——迁移前 xz 不在 registry 里所以 `findCapabilitiesByQuery` 搜不到它；迁移后搜到了但不受工具名过滤器保护。

### KTD4: 斜杠命令注册——`registerSlashCommand` + API 传输

**决策：** 在 `chat.js` 里把 `SLASH_COMMANDS` 从 `const` 改为 `let`（可变数组），导出一个 `registerSlashCommand(entry)` 函数。现有 5 个命令保持内联初始化。浏览器端不能直接 import 服务端 `capability-registry.js`（它依赖 `config.js`/`hotspots.js` 等服务端模块），因此通过一个新 API 端点 `GET /settings/slash-commands` 返回 capability 声明的斜杠命令（`{cmd, keys, label, desc}` 数组），`app.js` 初始化时 fetch 该端点并调用 `registerSlashCommand` 注册。`/xz` 的 `run` 回调调用 `openSettings?.("advanced")`——这个回调在浏览器端定义，不需要服务端模块。

**理由：** `chat.js`/`app.js` 是浏览器端代码，`capability-registry.js` 是服务端模块——两者不能直接 import。API 端点是天然的传输边界。现有菜单逻辑（`filterSlash`、`renderSlashMenu`、`showSlashHelp`）已泛化迭代 `SLASH_COMMANDS`，改为可变数组 + 注册函数后它们无需改动。

---

## Implementation Units

### U1. 扩展 listCapabilities() 增加 enabled 字段

**Goal:** 让能力清单能区分"已启用"和"未启用"的能力。

**Requirements:** R1（能力清单需要 enabled 状态）

**Dependencies:** 无

**Files:**
- `src/capabilities/capability-registry.js`（修改 `listCapabilities()` ~line 252，增加 `enabled` 字段计算）
- `src/capabilities/capability-registry.js`（修改 CAPABILITIES 条目类型——增加可选 `isEnabled` 字段说明）

**Approach:**
- `listCapabilities()` 的 map 输出增加 `enabled` 字段：对每个 capability 调用 `c.isEnabled ? c.isEnabled() : true`
- 不改变 `detect()` 的语义——`detect` 是"本轮关键词是否命中"，`isEnabled` 是"这个功能是否开启"（配置层面）。两者正交。
- xz 条目（U3 添加）会声明 `isEnabled: () => isXzToolsEnabled()`

**Patterns to follow:** `listApiSlotCapabilities()` (`api-slots.js:534`) 已有自己的 `enabled` 过滤逻辑，是先例。

**Test scenarios:**
- `listCapabilities()` 返回的对象包含 `enabled` 字段（boolean）
- 未声明 `isEnabled` 的 capability（如 weather）`enabled` 为 true
- 声明 `isEnabled: () => false` 的 capability `enabled` 为 false
- `enabled` 字段不影响现有 `detect()` / `capabilityToolsFor()` 行为

**Verification:** `listCapabilities()` 输出每个条目都有 `enabled` 字段；现有 `selectTools` / `find_tool` 行为不回归。

---

### U2. 系统提示词注入能力清单

**Goal:** Agent 每轮都看到一份极简能力概览。

**Requirements:** R1

**Dependencies:** U1（需要 `enabled` 字段）

**Files:**
- `src/prompt.js`（修改 `buildSystemPrompt()` ~line 626 附近，在 capability context blocks 注入后追加能力清单段）
- `src/capabilities/capability-registry.js`（可选：新增 `buildCapabilityManifest()` 辅助函数，格式化 `listCapabilities()` 为清单文本）

**Approach:**
- 在 `prompt.js:626-629` 的 capability blocks 注入之后，追加一段能力清单
- 清单格式：每行 `- {label} — {summary}` 或 `- {label} — {summary}（未启用）`
- 注入条件：无条件常驻（每轮都注入），因为它只有 ~6-10 行
- 数据源：`listCapabilities()` 的输出（含 U1 的 `enabled` 字段）
- 段落标题：类似 `## 你的能力域` 或 `## Capability Domains`
- 需要构建完整的 `capCtx`（当前 `prompt.js:626` 只有 `{text, rawText}`），但清单不需要 `detect` 结果（它是全量列表），所以 `capCtx` 可保持现状

**Patterns to follow:** `prompt.js` 现有的条件段落注入模式（`if (gate) { prompt += '\n\n${BLOCK}' }`）。

**Test scenarios:**
- `buildSystemPrompt()` 输出包含"能力域"段落
- 清单列出所有已注册的 capability（weather, hotspot, web, software-install, xz 等）
- xz 开关关闭时清单里 xz 行标注"（未启用）"
- xz 开关开启时清单里 xz 行无标注
- 清单总行数 ≤ 15 行（token 成本可控）

**Verification:** 系统提示词中包含能力清单段；清单正确反映各能力的 enabled 状态。

---

### U3. xz 工具迁移到 capability-registry

**Goal:** xz 工具从 tool-router 的原始 TOOL_GROUPS 迁移到 registry 的声明式条目，自动进入 `listCapabilities()` 输出。

**Requirements:** R3

**Dependencies:** U1（registry 已支持 `isEnabled` 字段）

**Files:**
- `src/capabilities/capability-registry.js`（新增 `xz-tools` capability 条目到 `CAPABILITIES` 数组 ~line 126）
- `src/memory/tool-router.js`（移除 `XZ_TOOLS` 常量 ~line 65、`XZ_TRIGGERS` ~line 139、`TOOL_GROUPS` 条目 ~line 229、`selectTools` 关键词门 ~line 375）
- `src/memory/tool-router.js`（**保留** `suppressed` 集合的 xz 添加 ~line 338-339——ActionLog 防御不迁移）
- `src/capabilities/executor.js`（**保留** `XZ_HIDDEN` find_tool 工具名过滤 ~line 543-545；**新增**对 `findCapabilitiesByQuery` 返回的 `capabilities[]` 数组按 `isXzToolsEnabled()` 过滤）

**Approach:**
- 新增 capability 条目：
  ```
  { id: 'xz-tools', label: '心理咨询工具',
    summary: 'xz_calendar（来访者/预约/缴费）+ xz_notes（临床笔记/归档/安全）本机 CLI',
    triggers: XZ_TRIGGERS, tools: ['xz_calendar', 'xz_notes'],
    detect: (ctx) => isXzToolsEnabled() && hits(ctx.text, XZ_TRIGGERS),
    isEnabled: () => isXzToolsEnabled(),
    context: <workflow 提示词——CLI 子命令用法概要> }
  ```
- `detect` 同时包含开关门和关键词门（替代原 `selectTools` 的 `isXzToolsEnabled() && hits(body, XZ_TRIGGERS)`）
- 不设 `toolWhen`（继承 `detect`——开关关或关键词没命中时不注入）
- `context` 块描述 CLI 用法概要（从现有 schema description 提炼）
- 移除 tool-router.js 中的 `XZ_TOOLS`/`XZ_TRIGGERS`/`TOOL_GROUPS` 条目/`selectTools` 关键词门——`capabilityToolsFor()` 已在 `selectTools` 里调用（line 390-391），接管注入
- **保留** `suppressed` 集合的 xz 添加（防 ActionLog keepalive）和 `executor.js` 的 `XZ_HIDDEN` 过滤（防 find_tool 发现）——这两处独立于 capability 注入路径
- `XZ_TRIGGERS` 常量可移到 `capability-registry.js`（或其导入），因为 registry 条目需要引用它

**Patterns to follow:** hotspot entry (`capability-registry.js:151-162`) 的完整字段结构；weather entry 的 `detect` + `context` + `prefeed` 模式。

**Test scenarios:**
- xz 开关开 + 关键词命中（"预约"）→ `selectTools` 注入 `xz_calendar` + `xz_notes`（通过 `capabilityToolsFor`）
- xz 开关关 + 关键词命中 → 不注入（`detect` 返回 false）
- xz 开关开 + 关键词没命中 → 不注入
- xz 开关关时 ActionLog keepalive 尝试捞回 → 被 `suppressed` 拦截（回归测试）
- xz 开关关时 `find_tool("预约")` → 被 `XZ_HIDDEN` 过滤（回归测试）
- `listCapabilities()` 输出包含 `xz-tools` 条目，`enabled` 反映开关状态
- 迁移后 `TOOL_GROUPS` 不再含 xz 条目（find_tool 的中文意图匹配改走 `findCapabilitiesByQuery`）

**Verification:** 开关双门行为与迁移前一致；`listCapabilities()` 包含 xz；现有 `test-tool-router` 测试不回归。

---

### U4. list_tools 提升可发现性 + 输出截断

**Goal:** Agent 被问"你能做什么"时能调用 `list_tools` 查看完整工具明细，且输出不撑爆上下文。

**Requirements:** R2

**Dependencies:** 无（独立于 U1-U3）

**Files:**
- `src/memory/tool-router.js`（修改 `ADMIN_TRIGGERS` ~line 178 或新增独立触发组，加入"你能做什么/能力/工具列表/list tools"等词；或将 `list_tools` 从 `ADMIN_TOOLS` 移到更宽的触发条件）
- `src/capabilities/executor.js`（修改 `execListTools` ~line 484，增加 description 截断到 ~120 字符 + 分组输出）

**Approach:**
- **触发提升：** 新建一个 `CAPABILITY_QUERY_TRIGGERS` 数组（`'你能做什么', '你有哪些工具', '能力', '工具列表', 'list tools', '什么工具'`），触发时只注入 `list_tools`。**不扩大** `ADMIN_TRIGGERS`——那会连带注入全部 11 个 ADMIN_TOOLS（含 `manage_api_capability`、`manage_rule` 等重 schema），浪费 token。
- **输出截断：** `execListTools` 的每条 description 调用 `.slice(0, 120)` 截断。保持分组（builtin / installed）。总数行不变。

**Patterns to follow:** `find_tool` 的 `desc.slice(0, 200)` 截断先例（`executor.js:559`）。

**Test scenarios:**
- 用户发"你能做什么"或"你有哪些工具"→ `selectTools` 注入 `list_tools`
- 用户发"帮我读文件"→ `list_tools` 不注入（不误命中）
- `execListTools()` 输出每条 description ≤ 120 字符
- 输出包含分组标题（builtin / installed）

**Verification:** 关键词命中时 `list_tools` 出现在工具列表中；输出体积可控。

---

### U5. 斜杠命令注册表

**Goal:** `chat.js` 的硬编码 `SLASH_COMMANDS` 改为可扩展注册表，xz 注册 `/xz`。

**Requirements:** R4

**Dependencies:** U3（xz capability 条目需要先存在，才能声明 slashCommand）

**Files:**
- `src/ui/brain-ui/chat.js`（`SLASH_COMMANDS` 从 `const` 改为 `let` ~line 557；导出 `registerSlashCommand(entry)` 函数）
- `src/capabilities/capability-registry.js`（xz 条目声明 `slashCommand: { cmd: '/xz', keys: ['xz','工具','日历','笔记'], label: '切换 xz 工具', desc: '开启/关闭 xz-calendar / xz-notes' }`）
- `src/api/routes/settings.js`（新增 `GET /settings/slash-commands` 端点——遍历 `listCapabilities()` 收集声明了 `slashCommand` 的条目，返回 `{cmd, keys, label, desc}` 数组）
- `src/ui/brain-ui/app.js`（app 初始化时 `fetch('/settings/slash-commands')`，对返回的每条调用 `registerSlashCommand`，`run` 回调设为 `openSettings?.("advanced")`——注意 `run` 在浏览器端定义，不引用服务端模块）

**Approach:**
- `chat.js:557` 的 `const SLASH_COMMANDS = [...]` 改为 `let SLASH_COMMANDS = [...]`
- 新增 `export function registerSlashCommand(entry) { SLASH_COMMANDS.push(entry) }`
- 所有消费者（`filterSlash`、`renderSlashMenu`、`showSlashHelp`）已泛化迭代 `SLASH_COMMANDS`，无需改动
- `app.js` 在 `initSettings` 之后 fetch `/settings/slash-commands`，注册返回的命令（`run` 回调在浏览器端定义：`openSettings?.("advanced")`）
- 服务端 `/settings/slash-commands` 端点遍历 `listCapabilities()`，过滤有 `slashCommand` 字段的条目，返回静态数据（不含 `run` 函数——`run` 由浏览器端根据 `cmd` 模式匹配设置）
- `slashCommand` 是 capability 条目的可选字段，省略时不返回

**Patterns to follow:** 现有 `SLASH_COMMANDS` 的 `{cmd, keys, label, desc, run}` 结构；`/llm` 的 `run: () => openSettings?.("llm")` 模式。

**Test scenarios:**
- 输入框打 `/` → 菜单包含 `/xz`
- 打 `/xz` 选中 → 打开设置面板高级功能 tab
- 现有 `/llm`、`/voice`、`/tts`、`/video`、`/help` 仍正常工作
- `/help` 输出包含 `/xz`
- 未声明 `slashCommand` 的 capability 不产生菜单项

**Verification:** 菜单出现 `/xz`；点击后跳到高级功能 tab；现有命令不回归。

---

## Scope Boundaries

### Deferred to Follow-Up Work

- per-subcommand 权限分级（code review 的 destructive surface 问题）
- 60s timeout 调整（backup/encryption 超时风险）
- prompt injection 防护（CLI 输出回流模型）
- find_tool 的"未启用"友好提示（R1 清单已覆盖此需求）
- capability_registry 迁移其余 TOOL_GROUPS 条目（仅迁移 xz，其余保持现状）

### Non-Goals

- 不重写 tool-router 的整体注入架构
- 不改 capability_demo 的硬编码演示序列
- 不加 per-capability 的 UI 管理面板

---

## Open Questions

*(均已通过 Phase 1 研究解决，记录为 KTD1-KTD4。无未解决问题。)*

---

## System-Wide Impact

- **系统提示词长度：** 增加 ~6-10 行能力清单。需在 U2 实现后验证 prompt 总 token 不超标。
- **tool-router 行为：** xz 注入路径从 `selectTools` 内联改为 `capabilityToolsFor`——行为等价，但调用路径变化需回归测试。
- **前端：** `chat.js` 导出新函数（`registerSlashCommand`），`app.js` 新增初始化遍历——改动范围可控。

---

## Definition of Done

1. 用户问"你有哪些工具/能力"时，agent 列出所有已注册能力域（含 xz），不再回答"没有"
2. xz 开关关闭时，agent 知道 xz 能力存在但未启用，能引导用户去设置开启
3. 输入框打 `/` 时出现 `/xz` 命令，点击打开高级功能设置
4. 现有工具注入行为不回归（`test-tool-router` / `test-config-upgrade` / `test-run-cli-noshell` 全绿）
5. 系统提示词中包含能力清单段，总 token 增量可控（< 200 token）
