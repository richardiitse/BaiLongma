---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
title: xz 文档动态加载 - Plan
date: 2026-07-16
---

# xz 文档动态加载 - Plan

## Goal Capsule

**目标：** BaiLongma 启动时从 xz-calender/xz-notes 项目目录读取 SKILL.md + CLI 合约文档，动态生成 xz 工具的 description 和 context block，替代硬编码。

**产品权威：** 硬编码的 xz 工具描述随 xz 项目更新而过时。xz 项目已有完整的自描述文档，应作为 single source of truth。

**阻塞项：** 无。

Product Contract unchanged.

---

## Problem Frame

BaiLongma 在 `src/capabilities/schemas/xz.js` 和 `src/capabilities/capability-registry.js` 里硬编码了 xz 工具的 description 和 context block。每次 xz-calender 或 xz-notes 更新 CLI，BaiLongma 的描述就过时。

---

## Requirements

- **R1:** 启动时（lazy init）从 xz 项目目录读取文档，路径从 `.env` 的 `XZ_*_CLI` 反推项目根
- **R2:** `schemas/xz.js` 的 description 改为动态（加载失败回退硬编码）
- **R3:** `capability-registry.js` 的 context 改为动态（加载失败回退硬编码）

---

## Key Technical Decisions

### KTD1: 路径反推——从 CLI 二进制路径剥离到项目根

从 `XZ_CALENDAR_CLI`（如 `.../xz-calender/.build/debug/xz-calendar`）反推项目根：向上查找包含 `Package.swift` 的目录。从 `XZ_NOTES_CLI`（如 `.../xz-notes/bin/xz-notes`）反推：向上查找包含 `package.json` 的目录。这比硬编码相对路径更健壮（不假设 sibling 布局）。

### KTD2: 文档分两层——description 极简 + context block 完整

- **Tool description**（常驻每轮 LLM 调用的 tools 数组）：保持极简——一句话概述 + 子命令名列表。从 cli-contract.md / capabilities --json 提取子命令名，不含参数细节。
- **Context block**（按关键词命中注入 system prompt）：放完整内容——SKILL.md / AGENTS.md 的全文。14KB 的 cli-contract.md 也放这里。Context block 仅在关键词命中时注入（`detect` 门控），不是每轮常驻。

### KTD3: lazy init + module 缓存 + fallback

加载器用 module-level 变量缓存，首次调用时加载（不是启动时 eager）。加载失败（文件不存在、CLI 不可用、JSON 解析错误）时回退到当前硬编码文本，打 warn 日志。xz 开关关闭时不触发加载（`isXzToolsEnabled()` 前置检查）。

### KTD4: xz-calendar 用 `.agents/` 路径作为 canonical

三个 SKILL.md 副本（`skills/`、`.agents/skills/`、`.claude/skills/`）中选 `.agents/skills/`——最新（7月8日），Swift 测试套件使用此路径。

---

## Implementation Units

### U1. 新建 xz 文档加载器

**Goal:** 从 xz 项目目录读取 SKILL.md / cli-contract.md / AGENTS.md / capabilities --json，缓存结果。

**Requirements:** R1

**Dependencies:** 无

**Files:**
- `src/capabilities/tools/xz-loader.js`（新）

**Approach:**
- 导出两个函数：`getXzCalendarDocs()` 和 `getXzNotesDocs()`，各返回 `{ description, contextBlock }`
- 路径反推：从 `process.env.XZ_CALENDAR_CLI` / `XZ_NOTES_CLI` 向上找 `Package.swift` / `package.json`
- xz-calendar：读 `.agents/skills/xz-calendar-cli/SKILL.md`（→ contextBlock）和 `.agents/skills/xz-calendar-cli/references/cli-contract.md`（→ 提取子命令名列表拼入 description）
- xz-notes：跑 `{XZ_NOTES_CLI} capabilities --json`（→ 提取能力名列表拼入 description），读 `AGENTS.md`（→ contextBlock）
- module-level 缓存：首次调用加载，后续返回缓存。`null` 缓存表示加载失败，回退硬编码
- description 控制在 ~500 字符以内（子命令名 + 一句话）；contextBlock 不截断

**Patterns to follow:** `src/cli-whitelist.js` 的 `readConfigBlock()` 模式（try/catch + fallback）；`src/capabilities/tools/xz.js` 的 `resolveXzCalendarBin()` / `resolveXzNotesBin()`（env 读取）。

**Test scenarios:**
- 路径反推：从 `.../xz-calender/.build/debug/xz-calendar` 正确推出 `.../xz-calender/`
- 路径反推：从 `.../xz-notes/bin/xz-notes` 正确推出 `.../xz-notes/`
- 加载成功：`getXzCalendarDocs()` 返回非空 description + contextBlock
- 加载成功：`getXzNotesDocs()` 返回非空 description + contextBlock
- 加载失败（文件不存在）：返回 null，不抛异常
- 加载失败（CLI 不可用）：返回 null，不抛异常
- 缓存：第二次调用不重新读文件

**Verification:** `getXzCalendarDocs()` 和 `getXzNotesDocs()` 返回有效内容；env 未设置时返回 null。

---

### U2. schemas/xz.js description 改为动态

**Goal:** 工具 description 从硬编码改为调用加载器（fallback 硬编码）。

**Requirements:** R2

**Dependencies:** U1

**Files:**
- `src/capabilities/schemas/xz.js`（修改）

**Approach:**
- 把 `buildXzSchemas()` 改为工厂函数（类似 `buildCliSchemas()`），首次调用时从 `xz-loader.js` 拿 description
- description = 加载器结果的 description 字段；加载失败时用当前硬编码文本
- schema 的 parameters（`{command, args}`）不变——只改 description 文本

**Patterns to follow:** `src/capabilities/schemas/cli.js` 的 `buildCliSchemas()` 工厂模式。

**Test scenarios:**
- 加载成功时 description 包含从 cli-contract.md 提取的子命令名
- 加载失败时 description 回退到硬编码文本
- parameters 结构不变（`{command, args}`，required `['command']`）

**Verification:** `TOOL_SCHEMAS.xz_calendar.function.description` 在加载成功时包含动态内容。

---

### U3. capability-registry.js context 改为动态

**Goal:** xz-tools 条目的 context block 从硬编码改为调用加载器（fallback 硬编码）。

**Requirements:** R3

**Dependencies:** U1

**Files:**
- `src/capabilities/capability-registry.js`（修改 xz-tools 条目的 `context` 字段）

**Approach:**
- xz-tools 条目的 `context` 从硬编码字符串改为 getter 函数或 lazy 字段：首次注入时从 `xz-loader.js` 拿 contextBlock
- 加载失败时回退到当前硬编码 context
- 注意：`capabilityContextBlocks()` 目前期望 `context` 是字符串。需要改为支持函数类型（`() => string`），或在 registry 条目初始化时 lazy 求值

**Patterns to follow:** `capabilityContextBlocks()` 的现有注入逻辑（`capability-registry.js:225`）。

**Test scenarios:**
- 加载成功时 context block 包含 SKILL.md / AGENTS.md 内容
- 加载失败时 context block 回退到硬编码文本
- context 仅在 `detect` 命中时注入（不每轮常驻）

**Verification:** 关键词命中时 system prompt 包含动态 context block 内容。

---

### U4. 集成验证

**Goal:** 端到端验证——加载器正确加载文档、description 和 context 反映 xz 项目实际内容。

**Requirements:** R1-R3

**Dependencies:** U1, U2, U3

**Files:**
- `src/capabilities/schemas.js`（修改 `xzSchemas` 的合并方式——如果 U2 改为工厂则需要）

**Approach:**
- 确认 `schemas.js` 的 `TOOL_SCHEMAS` 合并正确引用了新的工厂函数（如果 U2 改了形状）
- 确认 `capability-registry.js` 的 `capabilityContextBlocks()` 正确处理动态 context
- 运行现有测试确认不回归

**Test scenarios:**
- `TOOL_SCHEMAS.xz_calendar` 和 `xz_notes` 存在且有动态 description
- 现有测试 `test-config-upgrade` / `test-section-gate` / `test-tick-policy` / `test-run-cli-noshell` 全绿
- xz 开关关闭时不触发加载（`isXzToolsEnabled()` 前置）

**Verification:** 所有测试通过；加载器在开关开启时加载文档、关闭时不加载。

---

## Scope Boundaries

### Out of Scope

- 不自动生成 typed JSON Schema parameters——留后续迭代
- 不监听文件变化实时刷新——重启即生效
- 不解析 cli-contract.md 为结构化 JSON——文本直接拼入 description/context

---

## Definition of Done

1. xz-calender 的 cli-contract.md 更新后，重启 BaiLongma，agent 能看到新子命令
2. xz-notes 的 AGENTS.md 或 capabilities --json 更新后，重启后 agent 能看到
3. 文档文件不存在时，工具仍可用（回退硬编码）
4. xz 开关关闭时不触发文档加载
5. 现有测试全绿
