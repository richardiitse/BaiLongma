# 配置驱动的 CLI 工具调用（白名单，首版 gbrain）

## Problem
Jarvis 现在 TICK 自主干活时，调用本机其它应用 CLI 只能走 `exec_command`（任意 shell）。这有两个问题：(1) **模型不知道机器上装了哪些 CLI**，无法主动选择调用 gbrain 等本地能力；(2) `exec_command` 权限过宽（任意命令），不适合作为"逐步放开本地能力"的安全姿态。代价：agent 的自主能力被限制在 exec_command 的"全开"与"无"之间，没有"受限、可发现、可配置"的中间档；本地知识库 gbrain 这类能力无法被 agent 安全、稳定地复用。

## Evidence
- **Assumption — 需通过 TICK 实测验证**：操作者想让 agent 在 TICK 里调本机知识库 gbrain，但现状模型不知 gbrain 存在、且 exec_command 过宽不适合作为默认放开路径。尚无具体 TICK 失败记录；MVP 验收即首次实测。

## Users
- **Primary**：项目自用维护者/操作者——想让 agent 在 TICK 自主干活时复用本机 gbrain（本地知识库）等 CLI，并按"逐步放开、可配置白名单"的安全姿态扩展本地能力。
- **Not for**：终端用户（无感知）；需要任意 shell 执行的场景（已有 `exec_command` 覆盖，本能力不替代它）；自动发现并放开全部已装 CLI 的需求（首版不做）。

## Hypothesis
We believe **给 agent 一个配置驱动的 CLI 白名单调用能力（首版只放 gbrain）** will **让 agent 在 TICK 自主干活时安全、受限地调用本机知识库 gbrain，并以此为可扩展范式逐步放开更多本地 CLI** for **自用维护者**. We'll know we're right when **agent 在一次 TICK 里自主且正确地调通 gbrain ≥1 个真实子命令拿到结果，且白名单外的 CLI 调用被 100% 拒绝**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| gbrain 自主调通 | agent 在 TICK 里正确调通 gbrain ≥1 子命令并用到结果 | TICK 实测 |
| 白名单强制 | 白名单外 CLI 调用 100% 被拒 | 越界调用测试 |
| 可配置扩展 | 不改代码即可加第 2 个 CLI 并被 agent 调通 | M2 加一个 CLI 验证 |
| 安全姿态 | 调用走审计/超时/输出截断，不弱于 exec_command 的安全约束 | 审计日志 + 单测 |

## Scope
**MVP** — 一个**配置驱动的 CLI 白名单框架** + **gbrain 单个 CLI 入口**：agent 能"发现 gbrain 可用"并在 TICK 自主调用；白名单为数据/配置（首版只含 gbrain），越界被拒。

**Out of scope**
- 自动扫描/发现机器上全部已装 CLI — 首版手动配置白名单。
- 多 CLI 一次性放开 — 首版只 gbrain，框架留扩展（M2 验证）。
- CLI 参数 JSON-schema 自动生成 — 首版 gbrain 用最小参数描述即可。
- 破坏性子命令的细粒度拦截（如 gbrain 的写/删子命令黑白名单）— 首版默认偏向只读调用，细粒度留 M2+。
- 替换 `exec_command` — 两者并存，边界见 open questions。

## Delivery Milestones
<!-- 业务结果，不是工程任务。/plan 把每个 milestone 展开成实现计划。 -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | gbrain 可调（白名单 MVP） | agent 在 TICK 自主调通 gbrain ≥1 子命令，白名单外被拒 | complete | .claude/plans/cli-tool-invocation.plan.md（已实现并验证：run_cli + 声明式白名单复用 exec_command runner；app 实测模型自主调 `run_cli({cmd:'gbrain',args:'search 知识管理'})` → gbrain 跑通 ok:true；白名单外经 executor 拒绝分支 + 单测 isAllowed(curl/rm)=false；test-cli-whitelist 4 passed，regression 零回归。TICK 自主使用为后续自然观测项） |
| 2 | 白名单可配置化扩展 | 不改代码加第 2 个 CLI 并被 agent 调通，验证可扩展 | pending | — |

## Open Questions
- [ ] **白名单形态**：按 CLI 注册成"命名工具"（模型直接调 `gbrain` 工具，参数化） vs 通用 `run_cli({cmd, args})`+白名单配置？—— `/plan` 决定（需求层只要求"配置驱动、可扩展"）。
- [ ] **gbrain 的实际子命令/参数/输出形态**：是否长任务、输出多大、有无破坏性子命令 —— TBD，需 `gbrain --help` 实测后定参数描述与截断策略。
- [ ] **白名单配置存哪**：`config.json` 顶级字段 vs 独立文件 vs capabilities 市场已装工具机制 —— `/plan`（复用既有配置/市场机制优先）。
- [ ] **与 `exec_command` 的边界**：白名单 CLI 是否复用 exec 的沙箱/审计/策略（tool-policy）路径，还是独立通道 —— `/plan`。
- [ ] **失败/超时/输出截断**策略是否与 exec_command 对齐 —— `/plan`。

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 白名单配置写错 → 放开不该放的 CLI / 漏放 gbrain | 中 | 高 | 默认最小白名单（只 gbrain）；越界拒绝有测试；配置校验 |
| gbrain 输出过大撑爆 LLM 上下文 | 中 | 中 | 输出截断策略（与 exec_command 对齐） |
| 与 exec_command 权限重叠/混淆，agent 不知该用哪个 | 中 | 中 | 明确边界 + 让 agent 优先感知白名单 CLI |
| gbrain 有破坏性子命令（写/删知识库）被误调 | 中 | 中 | 首版偏只读；细粒度子命令拦截留 M2+ |
| gbrain 调用形态未实测（子命令/鉴权/长任务）导致 MVP 返工 | 中 | 中 | M1 第一步先 `gbrain --help` 实测定形态 |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
