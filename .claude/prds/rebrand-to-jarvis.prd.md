# 项目品牌重命名：白龙马 → Jarvis

## Problem
白龙马项目存在**品牌分裂**：运行时 agent 的人格名已经是「Jarvis」（`identity.js:39` 把 `jarvis` 当 canonical id，`index.js:421-422` 用 `role:'jarvis'`），但产品名、文档、UI 文案、prompt 自我介绍、package 元数据仍全是「白龙马/Bailongma」。一个产品两个名字，自用者想统一为单一对外名字「Jarvis」。**视为重启新项目，不考虑老用户自动更新兼容。** 代价：留着分裂，产品对外没有统一身份；且 prompt 里 "You run as the BaiLongma (白龙马) desktop app"（`prompt.js:285`）与 agent 自称 Jarvis 直接矛盾。

## Evidence
- **可验证的分裂**：运行时 persona = `jarvis`（`identity.js:39`、`index.js:421-422`），产品名 = 白龙马/Bailongma。
- **波及面**：18 个文件含中文「白龙马」、81 个文件含拉丁「bailongma」（含 `package.json` 的 `name`、`appId`、`productName`、publish 仓库）。
- **动机**：品牌统一（自用决策，n=1，对改名足够）。

## Users
- **Primary**：项目自用者（operator）——想让产品对外只有一个名字 Jarvis。
- **Not for**：现有 Bailongma 老用户——明确不考虑其自动更新兼容，视为新项目。

## Hypothesis
We believe **把项目品牌从「白龙马/Bailongma」全量统一为「Jarvis」**（显示 `Jarvis` / 标识 `jarvis`） will **消除 agent 人格(Jarvis)与产品名(白龙马)的分裂，让产品对外只有一个名字** for **我自己（自用，视为重启新项目）**. We'll know we're right when **应用启动后 UI/文档/窗口标题/包名/appId 全部不再出现「白龙马/Bailongma」，且应用能正常启动、主循环跑通**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| 残留计数 | 0 处「白龙马/Bailongma/bailongma」（排除 git 历史、本 PRD 自身、`.claude/` 旧引用） | 改完 `grep -r` 归零校验 |
| 启动可用 | 应用能 `npm start` 启动、backend `:3721` 起、主循环跑通 | 启动冒烟 |
| persona 一致 | UI/prompt 自我介绍 = Jarvis | 启动后看 prompt / 界面 |

## Scope
**MVP** — 全量替换：
- **用户可见**：`白龙马` → `Jarvis`（UI 文案、`prompt.js:285` 自我介绍、文档、`productName`、窗口标题）
- **代码标识**：`bailongma` → `jarvis`（`package.json` 的 `name`、`appId`、`productName`、publish 仓库引用）
- **形式约定**：显示串 = `Jarvis`；npm `name` / `appId` 等标识 = `jarvis`（小写，与运行时 persona 一致、合 npm 规范）

**Out of scope**
- 现有用户自动更新兼容（视为新项目）
- Git 历史里的旧名（不动历史）
- 重命名本地目录 / 重新 fork（环境层，非代码）
- 改运行时 persona 判断逻辑（`identity.js` 不动，已是 jarvis）

## Delivery Milestones
<!-- 业务结果，不是工程任务。/plan 把每个 milestone 展开成实现计划。 -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | 用户可见文案改名 | UI / prompt / 文档里「白龙马」→ Jarvis，显示层无残留 | in-progress | .claude/plans/rebrand-to-jarvis.plan.md |
| 2 | 代码标识与包元数据改名 | package name / appId / productName / 仓库引用 `bailongma` → `jarvis` | pending | — |
| 3 | 全量校验与启动冒烟 | grep 归零 + `npm start` 跑通 + persona 一致 | pending | — |

## Open Questions
- [ ] `test-verbatim.js` fixture「安装了白龙马智能体的朋友...」改不改（先确认该测试不依赖该确切串断言）。
- [ ] publish 仓库 `xiaoyuanda666-ship-it/BaiLongma` → 改成什么（影响 electron-builder publish；自用可暂留或新建）。
- [ ] appId `com.xiaoyuanda.bailongma` → `com.xiaoyuanda.jarvis`，owner 段 `xiaoyuanda` 保留？
- [ ] **非盲替**：3 个源 token（`白龙马` / `Bailongma` / `bailongma`）→ 2 个目标（`Jarvis` / `jarvis`），且出现在 appId、仓库路径、文件路径等**复合串**里——需逐处审查，不能全量 `sed`。

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 改 package `name`/`appId` 后 electron-builder/updater 配置不一致 → 构建失败 | 中 | 中 | `/plan` 核对 build 配置；构建冒烟 |
| 漏改 → UI/日志残留「白龙马」 | 中 | 低 | 改完 grep 归零校验（Milestone 3） |
| 误改 test fixture 破坏 verbatim 测试 | 低 | 低 | 改前确认断言；跑 `test-verbatim` |
| 盲替误伤语义引用（「白龙马」作为 key/枚举值） | 低-中 | 中 | `/plan` 逐处审查，不全量 `sed` |
| publish 仓库不存在/未建 → 发版失败 | 中 | 低 | 自用可暂留旧仓库或新建（待 open question 决策） |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
