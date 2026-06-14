# MiniMax-M3 模型支持

## Problem
白龙马自用场景下，当前 MiniMax provider 的默认模型 MiniMax-M2.7 在**工具调用**和**多轮推理**这两项能力上偏弱——而这两项恰恰是白龙马 agent 主循环（`runTurn` 工具调用、焦点栈多轮）最依赖的核心。自用者已实际对比过 MiniMax-M3，确认 M3 在这两项上优于 M2.7，但目前代码里没有 M3 选项，无法切换。代价：留在 M2.7 继续承受工具调用失败 / 多轮掉链，或被迫切到其他 provider。

## Evidence
- 自用对比观察：MiniMax-M2.7 在**工具调用**与**多轮推理**上的表现**不如 MiniMax-M3**（自用者已在外部对比过 M3，非纯预期/传闻）。
- 注：证据为 n=1 自用观察，样本小但维度具体，且恰好命中产品核心能力（agent 工具循环 + 多轮上下文）。

## Users
- **Primary**：项目自用者（operator）——日常用白龙马处理需要工具调用和多轮推理的任务，希望按任务切到更强的 M3。
- **Not for**：其他白龙马用户——本改动**不**把 M3 提为默认，不改变任何人的现有默认体验。

## Hypothesis
We believe **在 MiniMax provider 里把 MiniMax-M3 加为可选模型** will **让我能在工具调用和多轮推理任务上从偏弱的 M2.7 切到更强的 M3** for **我自己（自用）**. We'll know we're right when **设置里能选到 M3，实际切过去跑几天后确认工具调用成功率 / 多轮推理质量优于 M2.7**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| 可选性 | M3 出现在模型下拉并能成功发一条消息 | 手动在设置选 M3 → 发消息 → 有正常返回 |
| 工具调用质量 | 切 M3 后工具调用成功率 ≥ M2.7，无 nudge 风暴 | 自用几天观察（`llm.js` nudge 触发频率 / tool-loop safety-stop） |
| 多轮推理质量 | 主观优于 M2.7 | 自用对比 |

## Scope
**MVP** — 在 `src/config.js` 的 `MINIMAX_MODELS` 里加一个 MiniMax-M3 条目（**非默认、仅可选**），使其出现在模型选择里。不改默认模型、不改 baseURL、不动其他 provider。

**Out of scope**
- 把 M3 设成默认模型 —— 自用验证后再单独决定（见 Milestone 2）。
- M3 的其他变体（若存在 M3-pro / M3-mini）。
- 跨模型自动迁移已有对话。
- 其他 provider 的任何模型调整。

## Delivery Milestones
<!-- 业务结果，不是工程任务。/plan 把每个 milestone 展开成实现计划。 -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | M3 可选并可用 | 自用者能在设置里选到 MiniMax-M3 并正常对话 / 工具调用 | in-progress | .claude/plans/minimax-m3-support.plan.md |
| 2 | M3 质量验证与默认决策 | 自用几天确认工具调用 + 多轮推理优于 M2.7，决定是否提为默认 | pending | — |

## Open Questions
- [ ] **MiniMax-M3 在 API 侧的确切 `model` id 字符串** —— TBD，需查 MiniMax 官方文档 / 控制台确认（`/plan` 时 research-first）。
- [ ] M3 是否走同一个 `api.minimax.chat/v1` endpoint + 同一把 MiniMax key（假定是，待验证）。
- [ ] M3 是否支持白龙马主循环假设的并行工具调用等能力（待验证）。

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `model` id 写错 → API 报错 | 中 | 低（仅可选，不影响默认） | `/plan` 查官方文档确认；选 M3 发一条冒烟测 |
| M3 不支持并行工具调用 → 主循环回退 | 低 | 中（若切到 M3 跑） | `/plan` 核对能力；`llm.js` 已有 per-provider 并行降级 |
| M3 实际不如预期 | 中 | 低（可选，随时切回 M2.7） | 不设默认，自用几天再决定 |
| M3 成本 / 限流未知 | 低 | 低（自用规模小） | 先观察 quota（`/quota` 端点） |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
