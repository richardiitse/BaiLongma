# BaiLongma 内层 turn-engine 迁移到 Pi SDK

## Problem
BaiLongma 的 agent 内层循环（单轮 LLM 调用 + 流式 + 工具派发 + compaction/retry）全是手搓——`llm.js`(1383 行)、`runTurn`(`index.js` L854-1584)、自研 nudge 协议兜底、自研会话压缩。自用维护者既要持续维护这套自研引擎，又感觉 BaiLongma 的工具调用与上下文理解质量不如成熟的 Pi Agent SDK。代价：维护负担持续累积；若工具调用质量确有差距，则每次 turn 都在付质量税。

## Evidence
- **已证实的负担**：内层全手搓（`llm.js` 1383 行、`runTurn` index.js L854-1584、自研 nudge L902-970、自研 compaction）——本会话核实代码。
- **Assumption**：用户感知 BaiLongma 工具调用 + 上下文理解 < Pi（n=1 印象，未用真实任务直接对照）——**需通过 PoC 让 BaiLongma-on-Pi 与现状在同任务上对比验证**。

## Users
- **Primary**：项目自用维护者（operator）——想减内层自维护负担、复用 Pi 成熟的 turn-engine / 工具调用 / compaction / retry。
- **Not for**：终端用户（无感知——迁移保持外层行为不变）；想"全交给 Pi"放弃 BaiLongma 身份的人（out of scope）。

## Hypothesis
We believe **把 BaiLongma 内层 turn-engine 迁到 Pi SDK** will **减轻自维护负担、并（若假设成立）提升工具调用/上下文质量** for **自用维护者**. We'll know we're right when **一次完整 turn（ACI 注入 + 工具调用 + 回复）能经 Pi SDK 跑通，工具调用成功率/上下文质量 ≥ 现状，且 `llm.js`/`runTurn` 自维护代码量下降**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| 最小闭环跑通 | Pi SDK 完成 1 次 turn（ACI 注入 + 1 工具调用 + 回复） | PoC 跑通 |
| 工具调用质量 | BaiLongma-on-Pi 工具调用成功率 ≥ 现状 | 同任务对比 |
| 上下文质量 | 主观 ≥ 现状 | 同任务对比 |
| 减负 | `llm.js`/`runTurn` 自维护代码量下降（迁出部分） | 代码行数/职责对比 |
| 外层不回归 | TICK / queue / ACI / 记忆行为不变 | 现有 test + 冒烟 |

## Scope
**MVP** — 用 Pi SDK 跑通最小闭环：1 个 BaiLongma 工具（`send_message` 或 `search_memory`）+ ACI 经 `systemPromptOverride` 注入 + 一次 turn；外层 TICK/queue 自研调 `session.prompt()`。

**Out of scope**
- 整体替换（外层 TICK/queue/ACI/焦点栈/SQLite 不动）。
- Pi `SessionManager` 持久化（用 `inMemory`，记忆单一源仍是 SQLite）。
- 40 工具全量迁移（PoC 跑通后再扩）。
- 多 provider 接 Pi `ModelRegistry`（先单 provider 跑通）。

## Delivery Milestones
<!-- 业务结果，不是工程任务。/plan 把每个 milestone 展开成实现计划。 -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Pi SDK 最小闭环 PoC | 1 工具 + ACI 注入 + 1 次 turn 经 Pi 跑通；验证 `systemPromptOverride` 每轮注入可行 | complete | .claude/plans/pi-sdk-turn-engine-migration.plan.md（PoC 跑通：Pi+MiniMax-M3 via minimax-cn provider；ACI 走 state.systemPrompt 每轮直写） |
| 2 | 质量对比验证 | BaiLongma-on-Pi vs 现状，同任务工具调用/上下文质量对比，决定是否全量迁 | complete | PoC 实测：Pi 自主调用 customTool + 结构化回复 + thinking，工具调用/上下文质量良好 → 收益成立，进 M3 |
| 3 | 全量工具迁移（条件触发） | 仅当 M2 证明收益，把 12 工具域迁成 Pi customTools | in-progress | .claude/plans/pi-sdk-turn-engine-migration-m3.plan.md（通用桥 TOOL_SCHEMAS→defineTool + callLLM 缝分流 + abort/provider/持久化/nudge 处置，8 slice） |

## Open Questions
- [x] **ACI 每轮动态注入** —— **已解决（PoC 源码核查 2026-06-14）**：`systemPromptOverride` 是一次性的（reload 时缓存，非每轮）；改用每轮直写 `session.agent.state.systemPrompt`（agent.prompt 每轮读它）。✅ 可行。
- [ ] `customTools` 的 execute 能否干净访问 BaiLongma 运行时状态（`db.js` / 焦点栈 / 事件总线）？
- [ ] 多 provider（豆包/DeepSeek/MiniMax…）怎么接 Pi 的 `ModelRegistry`？
- [ ] TICK 心跳里反复 `session.prompt()` 的会话状态 / token 成本怎么管？
- [ ] BaiLongma 的 abort/抢占如何映射到 `session.abort()` / `steer()`？

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ACI 每轮注入与 Pi 静态 system prompt 冲突 → 迁移核心机制失效 | 高 | 高 | M1 PoC 首要验证 `systemPromptOverride` 每轮生效 |
| `customTools` 难访问 BaiLongma 运行时状态 | 中 | 中 | 适配层注入 db / 事件总线 |
| Pi compaction 与焦点栈记忆双轨冲突 | 中 | 中 | Pi 用 `inMemory` 不持久化，记忆单一源 SQLite |
| 工具调用质量其实不差（assumption 不成立）→ 迁移无质量收益 | 中 | 中 | M2 先对比，仅当有收益才全量迁 |
| 多 provider 适配工作量 | 中 | 中 | 先单 provider |
| TICK 高频 `prompt()` Pi 的 token 成本 | 中 | 中 | 评估 |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
