---
title: xz 工具 Scene-Shell 集成 - Plan
type: feat
date: 2026-07-17
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
origin: docs/ideation/2026-07-17-xz-tools-scene-shell-ideation.html
execution: code
---

# xz 工具 Scene-Shell 集成 - Plan

## Goal Capsule

- **Objective:** 让 xz 系列工具（xz_calendar / xz_notes）调用时优先通过 Scene-Shell 呈现交互界面，替代当前的纯文本 CLI 输出。分三个阶段渐进交付：context 引导起步 → 投影层基础设施 → 临床工作台旗舰特性。
- **Product authority:** AGENTS.md 硬规则优先（工具 JSON 形状 / system-context prompt 分离）；SCENE-PROTOCOL.md 的声明式原则优先（core 只声明语义状态，不指定像素）。
- **Open blockers:** 无——四个核心产品决策已确认。

---

## Product Contract

### Summary

xz 工具目前零 Scene-Shell 集成——`execXzCalendar`/`execXzNotes` 直接 spawn CLI，返回工具信封 JSON（`{ok, stdout, ...}`），Agent 收到 raw stdout 字符串需自己 parse 再用文字描述。本方案让 xz 工具调用结果通过 Scene-Shell 投影成声明式 surface（卡片/面板），心理咨询咨询师能快速扫视结构化信息（今日排班、缴费状态、待编译笔记），而非读文字描述。

### Problem Frame

心理咨询咨询师使用 Jarvis 管理来访者预约、缴费和临床笔记时，xz 工具的输出是扁平文本——即使 CLI 返回结构化 JSON（xz-notes 输出恒为 JSON），它被包在工具信封的 stdout 字符串里返回给 Agent，Agent 再用自然语言描述给用户。这在信息密度高的临床场景（今日 N 个预约、M 个待缴费、K 份待编译笔记）效率极低。

Scene-Shell 已有三个工具→surface 集成先例（天气 core 直投、软件安装 job 投影、安全确认 choice+confront），xz 完全没有套用任何一个。

### Requirements

**阶段 1：起步（context 引导 + 写操作确认）**

- R1. xz 能力的 context block（`capability-registry.js` 的 `xz-tools` 项）增加 Scene-Shell 引导规则，教 Agent 调完确定性查询后用 `ui_set` 投影结果。仿 `WEATHER_CONTEXT_BLOCK` 模式。
- R2. xz 写操作中**仅不可逆操作**弹 confront choice 确认卡片：创建预约、取消预约、笔记确认/拒绝、缴费状态变更。查询/列表类不确认。复用 `set_security` 的 `data.pending` 机制。

**阶段 2：投影层基础设施**

- R3. 建独立投影层（xz-scene 适配器），内含 per-command → surface 模板映射表。确定性查询（today/upcoming/缴费汇总）由 core 在检测到 xz 意图时直接调 CLI + 投影，不经 Agent 逐字段拼 surface。
- R4. surface id 按 语义自动生成（如 `xz-today-{date}`、`xz-payments-{month}`），Agent 无需记忆 id。

**阶段 3：临床工作台旗舰特性**

- R5. 一个持续在场的「咨询师临床工作台」复合 surface——今日排班 + 待缴费 + 待编译笔记聚合在 stack 面板。core 在 TICK 心跳时自动刷新（仿天气 ambient 投影）。
- R6. 工作台 intent=ambient（角落低调，不抢焦点），随状态 morph 更新而非重建。

**横切**

- R7. surface 中来访者身份信息默认显示真名，用户可在设置里开启「脱敏模式」（代号替代真名）。
- R8. xz CLI 不可用时（ENOENT），用 choice 卡片（intent=confront）引导用户配置，而非纯文字报错。

### Actors

- A1. 心理咨询咨询师（primary）——日常使用 xz 工具管理预约/缴费/笔记，需要快速扫视结构化信息。
- A2. Jarvis Agent——负责调用 xz 工具、在阶段 1 自主声明 surface、在写操作时弹出确认卡片。

### Scope Boundaries

**In scope**

- R1-R8 的全部工作，分三阶段交付。
- xz_calendar 和 xz_notes 两个工具的 Scene-Shell 集成。

**Deferred for later**

- 补 `form` kind（协议定义了但 shell 未实现）——创建预约的表单需求在阶段 1-2 用 confront choice 确认流替代；如未来需要复杂多字段表单再补。
- 补 `list`/`table` kind——阶段 1-2 用 stack+text 组合呈现列表；如视觉效果不理想再补专用 kind。
- Windows 安装器重新打包（属发版工作）。

**Outside this product's identity**

- xz CLI 本身的功能变更——本方案只做 CLI 输出→surface 的投影层，不改 xz-calendar/xz-notes CLI。
- 其他工具（hotspot/worldcup/software-install）的 scene 集成优化——它们已有先例模式，不在本次范围。

### Key Flows

- F1. 确定性查询投影（today/upcoming/缴费汇总）
  - **Trigger:** 用户说"今日排班"/"今天有什么预约" 或 TICK 心跳触发工作台刷新
  - **Actors:** A1, A2
  - **Steps:** core 检测 xz 意图 → 直接调 xz CLI（附 --json）→ 投影层解析 stdout → sceneStore.set → /scene WS → shell 投影成 surface
  - **Covered by:** R3, R4, R5

- F2. 写操作确认流（创建预约）
  - **Trigger:** 用户说"帮我创建一个预约，来访者 XX，明天 10 点"
  - **Actors:** A1, A2
  - **Steps:** Agent 调用 xz_calendar 收集信息 → 弹 confront choice 卡（预约摘要 + 确认/取消）→ 用户点确认 → scene intent handler 取 data.pending → 执行 CLI 写入
  - **Covered by:** R2

- F3. 工作台自动刷新
  - **Trigger:** TICK 心跳（L2 自主轮）
  - **Actors:** A2
  - **Steps:** core 在 onTick 检查工作台 surface 是否存在 → 调 xz CLI 刷新今日数据 → morph 更新工作台 surface（同 id，data 变化触发 shell 原地过渡）
  - **Covered by:** R5, R6

### Acceptance Examples

- AE1. **Covers F1.** Given 用户说"今日排班"，When Agent 处理该消息，Then 屏幕上出现一张 surface 展示今日预约列表（时间+来访者+状态），且 Agent 不再 send_message 文字复述卡片内容。
- AE2. **Covers F2.** Given 用户说"帮我约 XX 明天 10 点"，When Agent 收集完信息，Then 弹出 confront choice 卡片显示预约摘要（来访者/时间/时长），用户点"确认"后才真正执行 xz_calendar appointment create。
- AE3. **Covers F3.** Given 工作台已在场，When TICK 心跳触发，Then 工作台 surface 原地 morph 更新（预约状态变化、新增缴费记录），而非整卡重建。
- AE4. **Covers R7.** Given 用户在设置里开启脱敏模式，When surface 展示今日排班，Then 来访者显示为代号（C-001）而非真名。

### Success Criteria

- xz 确定性查询结果以 surface 卡片呈现，不再是纯文字描述。
- 不可逆写操作必须经 confront 确认卡片才能执行。
- 临床工作台在 TICK 心跳时自动刷新，咨询师打开 Jarvis 即见今日全貌。
- 全程遵守 SCENE-PROTOCOL.md：core 只声明语义状态，不指定像素/位置/尺寸。

### Outstanding Questions

- OQ1（deferred）：阶段 2 投影层解析 xz-calendar 的 stdout 时，非 --json 模式的输出（today/upcoming 可能是文本表格）如何解析？需在读 xz-calendar CLI 实际输出格式后确定。标记 deferred（执行时发现，非计划阻塞）。
- OQ2（deferred）：工作台 TICK 刷新频率——每次 TICK 都刷新还是按时间间隔节流？TICK 频率本身由 ticker.js 的 L2 自适应节奏控制。标记 deferred。

---

## Planning Contract

Product Contract preservation: Product Contract unchanged — R1-R8、Actors、Flows、Acceptance Examples 均原样保留，以下为实现层补充。

### Key Technical Decisions

- **KTD1. 混合分流触发（用户决策确认）。** 确定性查询（today/upcoming/缴费汇总）由 core 检测意图后直接调 CLI + 投影（仿天气模式 A）；写操作由 Agent 调完工具后弹 confront choice 确认卡片（仿 set_security 模式 C）；临床工作台由 core 在 TICK 心跳时自动刷新。三条路径按场景类型分流，不互相排斥。

- **KTD2. 仅不可逆写操作需 confront 确认（用户决策确认）。** 创建预约、取消预约、笔记确认/拒绝、缴费状态变更这四类有副作用且不可逆的操作必须弹 choice+confront 卡片。查询/列表/更新类不确认，避免高频操作繁琐。pending 变更存 `data.pending`，用户确认后 scene intent handler 取出 apply（完全复用 executor.js 的 set_security 机制）。

- **KTD3. TICK 心跳自动刷新工作台（用户决策确认）。** core 在 onTick 中检查工作台 surface 是否存在，存在则调 xz CLI 刷新今日数据并 morph 更新（同 id、data 变化触发 shell 原地过渡）。工作台 intent=ambient 不抢焦点。

- **KTD4. 脱敏默认关闭可开关（用户决策确认）。** surface 默认显示来访者真名；设置里新增「脱敏模式」开关，开启后 surface 中来访者用代号（C-001）。代号→真名映射由投影层在渲染时按 config 开关转换，Agent 上下文始终用真名。

- **KTD5. xz context block 追加 Scene 引导（不改架构）。** capability-registry.js 的 xz-tools 项 context 是函数式 lazy 求值，在它返回的文本末尾追加一段 XZ_SCENE_GUIDE（仿 WEATHER_CONTEXT_BLOCK 结构），教 Agent 调完确定性查询后用 ui_set 投影。这是阶段 1 最小改动路径——不建投影层、不补 kind，只教 Agent。

- **KTD6. 投影层作为独立文件（阶段 2 基础设施）。** 新建 `src/capabilities/tools/xz-scene.js`，内含 per-command → surface 映射表 + stdout 解析器。仿 software-install-scene.js 的独立投影层模式。surface id 按 语义自动生成（`xz-today-{date}`、`xz-payments-{month}`、`xz-workbench`）。

### High-Level Technical Design

三条分流路径，按 xz 子命令类型分发到不同的投影机制：

```mermaid
flowchart TB
    MSG[用户消息 / TICK 心跳] --> DETECT{core 意图检测}
    DETECT -->|查询类 today/upcoming/汇总| CORE[core 直接投影<br/>调 CLI + xz-scene 映射]
    DETECT -->|写操作 create/cancel| AGENT_W[Agent 收集信息<br/>+ confront choice 确认]
    DETECT -->|TICK 心跳| TICK[core 刷新工作台<br/>morph 更新]
    DETECT -->|Agent 自主查询| AGENT_R[Agent 调 CLI<br/>+ context block 引导 ui_set]

    CORE --> STORE[SceneStore.set]
    AGENT_W --> STORE
    TICK --> STORE
    AGENT_R --> STORE

    STORE -->|subscribe| WS[/scene WebSocket]
    WS --> SHELL[scene-shell 投影<br/>enter/morph/exit]
    SHELL --> USER[用户屏幕]
```

---

## Implementation Units

### U1. xz context block 追加 Scene 引导（阶段 1 起步）

- **Goal:** 在 xz 能力的 context block 末尾追加 ui_set 引导文本，教 Agent 调完确定性查询后自己投影结果。
- **Requirements:** R1
- **Dependencies:** 无
- **Files:** `src/capabilities/capability-registry.js`（修改 xz-tools 项的 context 函数）
- **Approach:** 在 xz-tools 项的 `context()` 函数返回值末尾追加一段 `XZ_SCENE_GUIDE` 常量文本（仿 `WEATHER_CONTEXT_BLOCK` 结构）。内容：列出哪些子命令适合投影（today/upcoming/payment-summary）、用哪个 kind（stack+text/metric）、surface id 命名约定、intent 选择（查询用 inform）。不建投影层、不补 kind——阶段 1 只教 Agent 用现有词汇表组合。
- **Patterns to follow:** `WEATHER_CONTEXT_BLOCK`（capability-registry.js:83-95）的「字段映射 + 调用示例 + 去重约束」三段式结构。
- **Test scenarios:**
  - **引导文本注入验证：** xz 关键词命中时，注入的 context 包含 `ui_set` 和 `stack`/`text` 字样（grep 注入文本）。
  - **fallback 路径保留：** xz-loader 加载失败时，fallback 文本仍包含 scene 引导段（不只返回旧概述）。
  - **Covers R1.**
- **Verification:** xz 意图命中时，Agent 收到的 context block 末尾有 scene 引导段落。

### U2. 写操作 confront 确认流（阶段 1 起步）

- **Goal:** xz 不可逆写操作（创建/取消预约、笔记确认/拒绝、缴费变更）弹出 confront choice 确认卡片，用户确认后才执行。
- **Requirements:** R2
- **Dependencies:** U1（context block 已就位）
- **Files:** `src/capabilities/executor.js`（在 xz_calendar/xz_notes 的 case 分发后加确认拦截），`src/capabilities/tools/xz.js`（可选：加确认守卫辅助函数）
- **Approach:** 在 executor.js 的工具分发中，xz_calendar/xz_notes 的 case 前加一层「不可逆操作检测」——检测 command 是否属于不可逆集合（appointment create/cancel、note confirm/reject、payment mark-paid）。命中则：构造 choice surface（intent=confront），pending 变更存 `data.pending`，返回 message 告诉 Agent「确认卡已挂出，不要 send_message 复述」。用户点确认后，scene intent handler（api.js 已有 setSceneIntentHandler）回查 surface 取 pending 执行 CLI。完全复用 executor.js:1120-1164 的 set_security 机制。
- **Patterns to follow:** `execSetSecurity`（executor.js:1120-1164）的 choice+confront+pending+返回 message 四件套。
- **Test scenarios:**
  - **不可逆操作弹卡：** Agent 调 xz_calendar command="appointment create" → 弹出 choice surface，intent=confront，options 含确认/取消。
  - **可逆操作不弹卡：** Agent 调 xz_calendar command="today" → 直接执行不弹卡。
  - **用户确认后执行：** 模拟 intent select value="confirm" → sceneStore.get 取出 pending → 执行 CLI 写入。
  - **用户取消后不执行：** 模拟 intent select value="cancel" → 不执行 CLI，surface 移除。
  - **Covers R2, F2, AE2.**
- **Execution note:** 写不可逆操作检测器时，先从 xz-loader 动态加载的 command 清单确认哪些子命令有副作用。
- **Verification:** 不可逆操作必须经确认卡才能执行；可逆操作直接执行。

### U3. xz-scene.js 投影层（阶段 2 基础设施）

- **Goal:** 建独立投影层，per-command 映射表把 xz CLI stdout 解析成结构化 surface data，供 core 直接投影。
- **Requirements:** R3, R4
- **Dependencies:** U1（context block 已教 Agent scene 概念）
- **Files:** `src/capabilities/tools/xz-scene.js`（新建），`src/index.js`（加 projectXzSurfaceForTurn 函数，仿 projectWeatherSurfaceForTurn）
- **Approach:** 新建 xz-scene.js 导出：(1) `XZ_COMMAND_MAP` — per-command → surface 模板映射表（today→stack+text、upcoming→stack+text、payment-summary→stack+metric）；(2) `parseXzStdout(command, stdout)` — 按 command 解析 CLI 输出为 surface data；(3) `xzSurfaceId(command, ...)` — 按 语义生成稳定 id（`xz-today-{date}`）。index.js 加 `projectXzSurfaceForTurn(message)` —— 检测 xz 查询意图 → 调 CLI（附 --json）→ xz-scene 解析 → sceneStore.set → 返回。仿 projectWeatherSurfaceForTurn 的「core 直接投影」模式。
- **Patterns to follow:** `software-install-scene.js`（独立投影层 + surfaceId 函数）；`projectWeatherSurfaceForTurn`（index.js:816-838，core 检测意图后直接投影）。
- **Test scenarios:**
  - **today 投影：** 模拟 xz_calendar today 的 JSON 输出 → 解析成 stack surface（含今日预约列表 text 项）。
  - **payment-summary 投影：** 模拟缴费汇总 JSON → 解析成 stack surface（含 metric 总额 + text 明细）。
  - **空结果处理：** CLI 返回空列表 → surface 显示「今日无预约」而非空白卡。
  - **surface id 稳定性：** 同一天调两次 today → 生成相同 id `xz-today-{date}`（幂等 morph 不重建）。
  - **CLI 错误降级：** CLI ENOENT 或非零退出 → 不投影 surface，返回 null（交由 U7 错误卡处理）。
  - **Covers R3, R4, F1, AE1.**
- **Execution note:** OQ1 在此解决——读 xz-calendar CLI 实际输出格式（--json vs 文本表格），确定解析策略。
- **Verification:** 确定性查询结果以 surface 卡片呈现，不经 Agent 逐字段拼。

### U4. TICK 心跳刷新工作台（阶段 3 旗舰）

- **Goal:** core 在 TICK 心跳时自动刷新「咨询师临床工作台」复合 surface（今日排班+待缴费+待编译笔记）。
- **Requirements:** R5, R6
- **Dependencies:** U3（投影层已就位，工作台复用其解析器）
- **Files:** `src/index.js`（在 onTick 中加工作台刷新逻辑），`src/capabilities/tools/xz-scene.js`（加 buildWorkbenchSurface 函数）
- **Approach:** xz-scene.js 加 `buildWorkbenchSurface()` —— 并发调 xz_calendar today + payment-summary + xz_notes pending-compile，组装成一个 stack surface（三个子区域：排班/缴费/笔记），intent=ambient。index.js 的 onTick 中，检查 `xz-workbench` surface 是否存在（sceneStore.get），存在则调 buildWorkbenchSurface 刷新（同 id morph），不存在则跳过（不主动创建——工作台由用户首次查询或显式请求时创建，TICK 只维持已在场的）。surface id 固定 `xz-workbench`。
- **Patterns to follow:** 天气 ambient 投影（index.js:827 intent:'ambient'）；ticker.js 的 TICK 节奏自适应。
- **Test scenarios:**
  - **工作台已存在时刷新：** sceneStore 有 xz-workbench → TICK 触发 → morph 更新（数据变化触发 shell 原地过渡）。
  - **工作台不存在时跳过：** sceneStore 无 xz-workbench → TICK 不创建（不主动打扰）。
  - **复合面板结构：** buildWorkbenchSurface 返回 stack 含 3 个子区域（排班 text 列表 + 缴费 metric + 笔记 text）。
  - **CLI 部分失败优雅降级：** 三个 CLI 调用中一个失败 → 该区域显示「暂时不可用」，其余正常。
  - **Covers R5, R6, F3, AE3.**
- **Execution note:** OQ2 在此解决——刷新频率跟随 TICK 节奏（ticker.js 的 L2 自适应间隔），不额外加节流。
- **Verification:** 工作台在 TICK 时自动 morph 刷新；不存在时不主动创建。

### U5. 脱敏模式开关（横切）

- **Goal:** 设置里新增「脱敏模式」开关，开启后 surface 中来访者显示代号而非真名。
- **Requirements:** R7
- **Dependencies:** U3（投影层渲染时按开关转换）
- **Files:** `src/capabilities/tools/xz-scene.js`（渲染时脱敏转换），`src/config.js`（加 redactMode 配置），`src/ui/brain-ui/app-shell.js`（设置面板加开关 UI），`src/ui/brain-ui/app.js`（开关事件绑定）
- **Approach:** config.js 加 `redactMode: false` 默认值 + parsedConfig 读取。xz-scene.js 的解析器在组装 surface data 时，检查 redactMode——开启则把来访者姓名替换为代号（C-{序号}，按 client-id 哈希或列表序号生成稳定代号）。Agent 上下文始终用真名（工具结果不脱敏，只 surface 脱敏）。设置面板加 checkbox 开关。
- **Patterns to follow:** 关闭提示音开关的「config + app-shell UI + app.js 绑定」三件套（已有的 alert-sound-pref 模式）。
- **Test scenarios:**
  - **默认不脱敏：** redactMode=false → surface 显示真名。
  - **开启脱敏：** redactMode=true → surface 显示代号（C-001），Agent 上下文仍是真名。
  - **代号稳定性：** 同一 client-id 多次投影 → 生成相同代号。
  - **Covers R7, AE4.**
- **Verification:** 脱敏开关在设置面板可用；开启后 surface 脱敏但 Agent 上下文不脱敏。

### U6. 工具不可用引导卡（横切）

- **Goal:** xz CLI 不可用时（ENOENT），用 choice 卡片引导用户配置，而非纯文字报错。
- **Requirements:** R8
- **Dependencies:** U3（投影层检测 CLI 可用性）
- **Files:** `src/capabilities/tools/xz-scene.js`（加 ENOENT 检测 + 引导卡投影）
- **Approach:** xz-scene.js 的 CLI 调用 wrapper 检测 ENOENT 错误，命中则投影一个 choice surface（id=`xz-cli-missing`，intent=confront），prompt 说明「xz 工具未安装」，options 含「打开配置说明」/「忽略」。返回给 Agent 的工具结果简化为「已弹出配置引导卡」。
- **Patterns to follow:** executor.js set_security 的 choice+confront+返回 message 模式。
- **Test scenarios:**
  - **CLI 不在时弹引导卡：** 模拟 spawn ENOENT → 投影 xz-cli-missing choice surface。
  - **CLI 正常时不弹：** 正常执行不弹引导卡。
  - **Covers R8.**
- **Verification:** CLI 不可用时弹出视觉引导卡而非文字错误。

---

## Verification Contract

| 验证项 | 方法 | 适用单元 | 通过标准 |
|---|---|---|---|
| context block 注入 | grep 注入文本含 ui_set + stack | U1 | 引导段存在 |
| 写操作确认拦截 | 模拟不可逆 command → 检查 choice surface | U2 | confront 卡弹出 + pending 存在 |
| 查询投影 | 模拟 xz JSON 输出 → 检查 surface data | U3 | 结构化 surface 正确生成 |
| surface id 幂等 | 同语义调两次 → id 相同 | U3 | 幂等 morph 不重建 |
| 工作台 TICK 刷新 | 模拟 TICK + sceneStore 有 workbench → morph | U4 | 原地更新不重建 |
| 脱敏开关 | redactMode=true → surface 代号 / Agent 真名 | U5 | 双通道正确 |
| CLI 错误引导 | 模拟 ENOENT → choice 卡 | U6 | 引导卡弹出 |

**执行方向**：优先用 Electron 运行时冒烟验证（xz CLI 实际可用时），辅以纯逻辑单测（xz-scene 解析器/映射表的合成数据测试，不依赖 CLI）。注意 Node CLI 的 better-sqlite3 ABI 不匹配（AGENTS.md 已知问题）——涉及 SQLite 的测试走 Electron。

---

## Definition of Done

### 全局完成标准

- xz 确定性查询结果以 surface 卡片呈现（阶段 2 完成）。
- 不可逆写操作经 confront 确认卡才能执行（阶段 1 完成）。
- 临床工作台在 TICK 时自动 morph 刷新（阶段 3 完成）。
- 全程遵守 SCENE-PROTOCOL.md：core 只声明语义状态，不指定像素/位置/尺寸。
- 废弃代码清理：实验性/死代码移除。

### 按阶段完成标准

- **阶段 1（U1+U2）：** context block 有 scene 引导；不可逆操作弹确认卡。可在 1-2 天内交付。
- **阶段 2（U3）：** 投影层基础设施就位；确定性查询 core 直投。
- **阶段 3（U4）：** 工作台 TICK 自动刷新；旗舰特性可用。
- **横切（U5+U6）：** 脱敏开关 + 错误引导卡。
