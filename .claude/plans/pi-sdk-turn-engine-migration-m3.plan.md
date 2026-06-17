# Plan: 全量工具迁移 — 内层 turn-engine 迁到 Pi SDK（milestone #3）

**Source PRD**: `.claude/prds/pi-sdk-turn-engine-migration.prd.md`
**Selected Milestone**: #3 — 全量工具迁移（条件触发）
**Complexity**: Large（多模块、有协议兜底处置 + 持久化边界 + 多 provider + 中断映射；但用"通用桥"避免 40 工具逐个手迁）

## Summary
M1 已证明 Pi+MiniMax-M3 经 `minimax-cn` provider 能跑通单轮（ACI 每轮走 `session.agent.state.systemPrompt` 直写）。M3 把 BaiLongma 内层 turn-engine（`llm.js` 的流式 + 工具循环 + nudge）**整体替换为 Pi `session.prompt()`**，外层 TICK/queue/ACI/焦点栈/SQLite 不动。核心策略：**不逐个迁 40 工具，而是写一个通用桥**把 `TOOL_SCHEMAS` 注册表运行时转成 Pi `defineTool`，每个 `execute` 调既有 `executeTool(name,args,context)`；迁移缝 = `runTurn` 内的 `callLLM` 调用点，用 config flag 切换，`llm.js` 留作 fallback。

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| 工具 schema 注册表 | `src/capabilities/schemas.js:17` `TOOL_SCHEMAS`（12 域合并的 flat `{name:schema}`）+ `getToolSchemas(names)` | 通用桥遍历此 map → `defineTool`，不手写每工具 |
| 工具执行 | `src/capabilities/executor.js:268` `executeTool(name,args,context)`（context 带运行时状态） | customTool 的 `execute` 直接转发 `context` |
| 内层 turn-engine 接口 | `src/llm.js:745` `callLLM({systemPrompt,message,messages,tools,signal,onStream,onToolCall,onToolExecute,onRetry,toolContext,...})` | Pi 适配器暴露**同一 callback 面**，runTurn 改动最小 |
| ACI 每轮注入 | PoC `sandbox/pi-poc.mjs:45` `session.agent.state.systemPrompt = <本轮 ACI>`（每轮直写） | runPiTurn 每轮 `prompt()` 前直写 |
| 中断/抢占 | `src/index.js:102` `currentAbortController`，L1766 抢占 abort、L1599 watchdog abort | 单点追加 `session` 级 abort |
| 测试 | `src/test-*.js`（`node:assert/strict` + 纯 `node`）+ smoke `npm run smoke:tools\|brain-ui\|social` | 新模块配 `test-pi-*.js`；不破坏现有 |
| config flag | `config.json` 运行时配置 + `src/config.js` 读取 | 新增 `turnEngine: "llm"\|"pi"`，默认 `"llm"` |

## Files to Change
| File | Action | Why |
|---|---|---|
| `config.json` | UPDATE | 加 `"turnEngine": "llm"`（默认走现状，零回归） |
| `src/config.js` | UPDATE | 导出 `getTurnEngine()` 读取器 |
| `src/pi/turn-engine.js` | CREATE | Pi turn-engine 适配器 + 通用工具桥（核心） |
| `src/pi/tool-bridge.js` | CREATE | `TOOL_SCHEMAS` → `defineTool[]` 通用转换 |
| `src/pi/providers.js` | CREATE | BaiLongma provider/model → Pi provider/modelId 映射 |
| `src/pi/persist-bridge.js` | CREATE | Pi inMemory 会话 ↔ SQLite 镜像（单一源仍是 SQLite） |
| `src/test-pi-tool-bridge.js` | CREATE | 桥转换 + execute 转发的纯单测（mock executeTool） |
| `src/index.js` | UPDATE | `runTurn` 内 `callLLM` 调用点按 flag 分流到 `runPiTurn`；abort 单点接 Pi |
| `sandbox/pi-bridge-smoke.mjs` | CREATE | Slice 1 端到端冒烟（真调一个带参工具，如 send_memory） |

## Tasks

### Slice 0 — config flag 骨架（零行为变更）
- **Action**: `config.json` 加 `"turnEngine":"llm"`；`config.js` 导出 `getTurnEngine()`。
- **Mirror**: 既有 config 读取风格。
- **Validate**: `node -e "import('./src/config.js').then(m=>console.log(m.getTurnEngine()))"` 输出 `llm`。

### Slice 1 — 通用工具桥 + Pi 适配器（核心，覆盖全部工具）
- **Action**:
  - `src/pi/tool-bridge.js`：`buildPiTools(toolNames, context) => defineTool[]`。遍历 `getToolSchemas(toolNames)`，每个 → `defineTool({ name, label, description, parameters: schema.input_schema ?? schema, execute: async (args) => normalizeResult(await executeTool(name, args, context)) })`。结果归一：`executeTool` 返回 string 或 json → 包成 Pi `{content:[{type:'text',text}],details:{}}`。
  - `src/pi/turn-engine.js`：`runPiTurn({systemPrompt,message,messages,tools,toolContext,signal,onStream,onToolCall,onToolExecute})`。`createAgentSession({sessionManager:SessionManager.inMemory(), model, authStorage, modelRegistry, tools:[...toolNames], customTools: buildPiTools(toolNames,toolContext), resourceLoader})`；每轮前 `session.agent.state.systemPrompt = systemPrompt`；`session.subscribe`：`text_delta`→`onStream`，`tool_execution_start/end`→`onToolCall/onToolExecute`；`await session.prompt(message)`。
  - 审计 `executeToolUnchecked`（executor.js:131）读的 `context.*` 字段，确认 `toolContext` 已全量透传（resolve open-Q #1）。
- **Mirror**: PoC `sandbox/pi-poc.mjs`；`callLLM` callback 面。
- **Validate**: `node sandbox/pi-bridge-smoke.mjs`（真调一个**带嵌套参数**的工具，验证桥处理复杂 schema，不只是 PoC 的空参 `get_note`）；`node src/test-pi-tool-bridge.js` 绿。

### Slice 2 — runTurn 缝接入（flag 分流）
- **Action**: 在 `runTurn` 调 `callLLM` 处按 `getTurnEngine()` 分流：`pi` → `runPiTurn(同参)`，否则 `callLLM`。`llm.js` 一字不改（fallback）。
- **Mirror**: 现有 `signal: controller.signal` 透传。
- **Validate**: `turnEngine:"llm"` 全套 `node src/test-*.js` 绿 + `npm run smoke:tools` 绿（证明零回归）；`turnEngine:"pi"` 启动能答一条消息。

### Slice 3 — 中断/抢占映射
- **Action**: **先验证 Pi abort API**（读 Pi 源码 / docs：`session.abort()` / `steer()` 是否存在、签名）。在 `currentAbortController` 触发处（`index.js` L1766 抢占、L1599 watchdog）追加 Pi session 级中断。若 Pi 无运行中 abort → 退化方案：preempt 时 `session.dispose()` + 下轮新建会话（代价：丢 Pi 侧未落 SQLite 的 in-flight 流，但 SQLite 是唯一源，可接受）。
- **Mirror**: 既有 `throwIfAborted(controller.signal)` + `createAbortError`。
- **Validate**: pi 模式下发长任务、中途插一条用户消息 → 前一 turn 停止（行为同现状）。

### Slice 4 — 多 provider 注册表
- **Action**: `src/pi/providers.js`：`resolvePiModel(bailongmaProvider, modelId)`。`minimax-cn` 走内置 `getModel`；deepseek/openai/qwen/moonshot/zhipu/mimo 优先 Pi 内置，否则配 Pi custom provider（OpenAI 兼容 models.json）。未验证通的 provider → 在 pi 模式启动时 warn 并回退 `llm` 路径（不硬扛）。
- **Mirror**: PoC `getModel("minimax-cn", id) || registry.find(...)`。
- **Validate**: 至少 1 个**非 minimax** provider 在 pi 模式下解析到 model（非 null）。

### Slice 5 — 持久化边界
- **Action**: `src/pi/persist-bridge.js`：Pi inMemory 会话**按 lane 长存**（不每轮新建）；subscribe 里把 assistant turn + tool call 镜像进 SQLite（`conversations`/`action_logs`），保证 SQLite 仍是唯一源。重启后 Pi 会话为空 → 由 `runInjector`（ACI）+ 近期 timeline 重建上下文（现状已是这个机制，无回归）。
- **Action**: 测 TICK 高频 `prompt()` 的 Pi 会话 token 增长；超阈值则周期性 `dispose()`+重建（开新会话）。
- **Mirror**: 既有 `runInjector` + `getRecentConversationTimeline`。
- **Validate**: pi 模式跑几轮 → 重启 app → 问"我刚才说了啥" → 从 SQLite 历史答出（不丢）。

### Slice 6 — nudge 处置（观察 → 决策）
- **Action**: 先让 pi 路径**不带** BaiLongma nudge（L902-970），记录"忘记回复/send_message/upsert_memory"案例。**决策门**：若 Pi 自带 `auto_retry` + 工具循环覆盖 → pi 路径退役 nudge（llm 路径保留）；若回归 → 只把最小守卫（finalNudge / send_message reminder）作为**turn 后检查**移植（不进 Pi 内部循环）。
- **Mirror**: 无（这是已知地雷，需 dogfood 证据）。
- **Validate**: 自用 dogfood（建议 ≥1 周），对比 pi vs llm 路径"静默无回复"发生率；写进 plan 结论。

### Slice 7 — A/B 对比 + 决定默认
- **Action**: 3 个真实任务同测 pi vs llm（多工具链 / 写记忆 / 社交 send_message）。全绿且 pi ≥ llm → 把默认 `turnEngine` 翻成 `"pi"`，`callLLM` 标 deprecated（**不删**，留 fallback）。否则记录差距、保持 `llm` 默认、pi 作可选。
- **Mirror**: PRD success metrics（工具调用质量/上下文质量 ≥ 现状）。
- **Validate**: `npm run smoke:tools|brain-ui|social` 全绿 + a/b 结论落 plan。

## Validation
```bash
node src/test-pi-tool-bridge.js            # Slice 1 桥单测
node sandbox/pi-bridge-smoke.mjs           # Slice 1 真工具冒烟（带嵌套参数）
node src/test-*.js                         # 全套单测零回归（llm 路径）
npm run smoke:tools && npm run smoke:brain-ui && npm run smoke:social
# pi 模式手测：config.json turnEngine="pi" → 发消息 → 收回复 + 工具调用 + 中断 + 重启不丢
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| 通用桥 schema 形状与 Pi 期望不符（嵌套参数） | 中 | Slice 1 smoke **必须**用带嵌套参数的工具（非 PoC 空参），早暴露 |
| Pi 运行中 abort API 未实测存在 | 中 | Slice 3 第一步读 Pi 源码确认；无则退化 dispose+重建（SQLite 唯一源可接受） |
| **nudge 回归（静默无回复，CLAUDE.md 头号地雷）** | 高 | Slice 6 dogfood 门控，未过证据**不翻默认 pi**；nudge 先保留 llm 路径 |
| `executeToolUnchecked` 读全局态、context 未全透传 | 中 | Slice 1 审计其 `context.*` 读取，补齐 toolContext |
| TICK 高频 `prompt()` Pi 会话 token 无界增长 | 中 | Slice 5 测 + 周期重建 |
| 多 provider 映射不全 | 中 | Slice 4 未验证 provider 回退 llm 路径，不硬扛 |
| `llm.js` 1383 行与 pi 路径长期双轨维护成本 | 低（M3 内） | M3 后据 a/b 决定：退役则 callLLM 标 deprecated；保留则 pi 作可选 |

## Open Questions 回流
- [x] **#1 customTools 访问运行时状态** → **可（Slice 1 核查后确认）**：execute 接 `context` 透传给 `executeTool`，`executeToolUnchecked` 读的 `context.*` 审计补齐。
- [ ] **多 provider 接 ModelRegistry** → Slice 4 给映射表；内置优先、custom OpenAI 兼容兜底。
- [ ] **TICK 反复 prompt() 会话/token 成本** → Slice 5 实测 + 周期重建。
- [ ] **abort/抢占映射 session.abort/steer** → Slice 3 验证 API；退化 dispose+重建。

## Acceptance
- [ ] Slice 0–2：`turnEngine:"pi"` 跑通一个完整 turn（ACI + **带嵌套参数工具** + 回复）；`llm` 路径零回归
- [ ] 通用桥覆盖全部 `TOOL_SCHEMAS`（无逐工具手写代码）
- [ ] Slice 3：pi 模式抢占/中断行为同现状
- [ ] Slice 4：≥1 个非 minimax provider 在 pi 模式解析到 model
- [ ] Slice 5：SQLite 唯一源，重启不丢历史
- [ ] Slice 6：nudge 处置有 dogfood 证据（退役 or 守卫，二选一有据）
- [ ] Slice 7：a/b 3 任务 pi ≥ llm；smoke 全绿；默认翻 pi or 保持 llm 有结论

---
*M3 是多日 refactor，按 Slice 0→7 增量推进，每 Slice 独立可验证、全程 flag 可回退。执行前需用户确认。*

## 🚨 Slice 2 app 验证结果（2026-06-14 实测，重要修正）

**两个发现，其中第二个是 M3 可行性级阻塞：**

1. **config 文件搞错（已修正）**：Electron app 读的是 userData 下的 `~/Library/Application Support/Jarvis/config.json`（`src/paths.js` `paths.configFile = USER_DIR/config.json`），**不是仓库 `./config.json`**。最初改仓库 config 的 `turnEngine:"pi"` 从未生效——之前所有"pi app 冒烟"的回复其实都走 `callLLM`（llm 路径）。`[pi]` 诊断日志为空时才暴露。**教训：测 app 行为必须改 AS 那份 config。**

2. **🔴 Pi SDK 在 Electron 主进程跑不起来**：真实 pi 配置下，`runPiTurn` 抛 `webidl.util.markAsUncloneable is not a function`，3 次重试后丢消息。
   - 根因：Pi SDK 自带的 undici（`@earendil-works/pi-coding-agent/node_modules/undici/lib/web/websocket/events.js:16/29`）调用 `webidl.util.markAsUncloneable`，Electron 33 运行时没有该函数（系统 Node 22 的 undici 6.25.0 有 → 所以纯 node smoke 能跑）。
   - 即：**Pi SDK 能在纯 node 跑（smoke 已证），但在 Electron 主进程崩**。这与 better-sqlite3 正好相反（sqlite 要 Electron ABI，Pi 要 node 运行时）。
   - **Slice 2 验收未达标**：pi 路径在 app 内不可用。

**候选解法（待评估，属 Slice 2 新增范围）**：
- (a) 把 `runPiTurn` 放进 **Electron utilityProcess / node child_process**（系统 node 22 环境，= smoke 环境），主进程经 IPC 调用。最干净，绕开 Electron 运行时不兼容。
- (b) 给 Pi SDK 的 undici 打补丁 / 锁版本，让 `webidl.util.markAsUncloneable` 存在。
- (c) 找 Pi SDK 配置绕开 websocket 传输（若 minimax-cn 能纯 fetch/stream 不走 WS）。

**结论**：Slice 0–2 的**代码**正确（单测 + 纯 node smoke 全绿），但**在 Electron 内集成 Pi 存在运行时阻塞**。M3 全量迁移的可行性因此存疑——需先解决 Electron 兼容（候选 a/b/c）才能继续。

## ✅ Slice 2 阻塞已解 — worker 隔离（2026-06-15，采纳候选 a 的修正版）

**关键修正**：`utilityProcess` 解不了——它与主进程共享 Electron 的 Node 运行时，webidl 缺失依旧。**必须用系统 node 子进程**（`child_process.fork(execPath=系统 node)`），= smoke 环境。

**实现**（已落地）：
- `src/pi/worker.mjs`（新）：系统 node 下跑 Pi SDK（createAgentSession + session.prompt + 流式）。工具执行经 `exec_tool_req/res` IPC RPC 回主进程（主进程持有 db/sandbox 运行时）。
- `src/pi/turn-engine.js`（重写）：`runPiTurn` fork 系统 node worker（`findNodeBin` 在 `node`/`/usr/local/bin/node`/`/opt/homebrew/bin/node`/`~/.local/bin/node` 里找），IPC 驱动；导出签名不变（index.js 零改）。
- 工具 schema 经纯 `tool-transform.js` + `defineTool`（worker 不 import executor/db）。

**验证（app 级，turnEngine=pi）**：
- `[pi] worker ready · node v22.22.3`（Electron fork 出系统 node worker）✅
- `markAsUncloneable` 错误 = **0**（之前必崩）✅
- `[工具调用] upsert_memory` → `[DB] PATCH 记忆`：工具 RPC 回主进程 → 真 executeTool → 落库 ✅
- TICK 轮经 Pi 出回复：`Jarvis: TICK 00:57 acknowledged...` ✅
- worker 直跑 smoke（stub 工具）全绿：流式 + 工具 RPC + 兜底投递 + end ✅

**🟡 新 gap（非隔离问题，属 Slice 6 nudge）**：用户消息轮里模型调了 upsert_memory 后**不产出 send_message/正文** → `nothing deliverable`，用户收不到回复。llm 路径靠 callLLM 的 nudge 强制补回复；pi 路径还没有 → **进 Slice 6 时必须解决**（最小 finalNudge：模型只调工具没回复时，runtime 兜底一句 ack 或强制一轮回复）。

**结论更新**：Electron 兼容阻塞**已清除**，Pi 能在 app 内跑通（worker 隔离）。剩 Slice 6 的 nudge 投递 gap。`turnEngine:"pi"` 当前**可启动但用户消息会哑**——默认仍 `llm`，翻 pi 前先补 Slice 6 最小 nudge。
