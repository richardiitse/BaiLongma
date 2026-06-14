# Jarvis — 项目协作约定

> 持续运行的本地数字生命体框架。Electron 33 + 本地 SQLite + OpenAI 兼容 LLM。
> 完整架构见仓库根 `ARCHITECTURE.md`（权威）与 `AGENTS.md`。本文件只放"用 Claude Code 干活时必须知道的事"。

## 硬性栈约束（违反即浪费一轮）

- **纯 JavaScript (ESM)**，`package.json` `"type":"module"`。无 TypeScript、无 tsconfig——不要引入 `.ts`，不要建议 `tsc`。
- **无 lint / format 配置**：仓库没有 eslint / prettier / tsc。因此**不要装 PostToolUse 的 format/lint/typecheck hook**——它们无目标，只会报错。
- **无前端框架**：brain-ui 是原生 DOM + d3 + vendored Three.js。React/Vue/Next 技能不适用。
- **包管理器是 npm**（`package-lock.json`）。不要用 pnpm/yarn。
- **SQLite 跑在 Electron 主进程**（`src/db.js`），不在渲染进程——这是安全姿势，别改。
- **构建目标是 Windows NSIS**（`npm run build`）。Mac 是开发机，不是产物平台。
- `.opencode/` `.codegraph/` `.mavis/` 是 AI 工具缓存，**不是源码**，已在 .gitignore。`.harness/reins/` 是项目的 6 个 agent 团队定义，**要跟踪**。

## 关键代码路径（改需求先看这里）

| 想改什么 | 看哪里 |
|---|---|
| 主循环 / 消息处理 | `src/index.js` `runTurn` (~L854)，外层包 `runTurnWithWatchdog` (~L1590，防 LLM/fetch 卡死) |
| 抢占式优先队列 | `src/queue.js`（user=100/background=50）+ `shouldPreemptFor` (index.js ~L732) |
| LLM 忘调 send_message 的补救 | **`src/llm.js` 的 nudge 系统**（L635/750-755/902-970），不是 `src/runtime/tool-protocol.js`（那个只有 11 行，管 `skip_*`） |
| 上下文组装 / ACI 注入 | `src/memory/injector.js` + `src/context/` + `src/prompt.js` |
| 记忆检索 | `src/memory/injector.js` + `src/embedding.js`（bge-small-zh，FTS5 兜底） |
| DB schema / 全部查询 | `src/db.js`（2605 行，已知大模块） |
| 工具执行 / 沙箱 / 市场 | `src/capabilities/executor.js` + `sandbox.js` + `marketplace/` |
| HTTP API / SSE / WS | `src/api.js`（默认 :3721，仅 127.0.0.1） |

## DAILY 优先技能集（agent-sort 核定，已全局可用，无需重装）

agentic-engineering · agent-harness-construction · agent-introspection-debugging · autonomous-loops · continuous-agent-loop · mcp-server-patterns · e2e-testing（项目有 Playwright smoke）· security-scan/security-review · codebase-onboarding · cost-aware-llm-pipeline · prompt-optimizer · coding-standards · git-workflow

> TypeScript / 框架(react/vue/next) / 其他语言 / 其他 DB / 云容器 / 垂直行业 类技能 → LIBRARY，按需取，不默认加载。

## 6 个 Rein 职责边界（改东西前先认领，见 `.harness/reins/`）

- `loop-runtime-expert` — 主循环 + queue + db.js facade + events
- `memory-context-expert` — 记忆 + 上下文 + prompt + LLM 调用
- `capabilities-expert` — 工具 schema + 执行器 + 沙箱 + 市场
- `integrations-expert` — 社交连接 + 语音 + providers + Electron 壳
- `ui-electron-expert` — Brain UI 前端 + 9 个 HTML 入口
- `quality-gate` — 测试 + smoke + 依赖审计 + 密钥扫描

跨 rein：DB schema 变更由 loop-runtime-expert 主导、其他签字；密钥/凭证任何改动都过 quality-gate。

## 已知地雷（动手前必读）

1. 🔴 **`config.json` 含明文 API key 且被 git 跟踪**（doubaoKey / volcAsrApiKey）。改凭证相关代码时不要把真实 key 写进任何会被提交的地方。`.env` 已正确 ignore。
2. **大文件超 800 行上限**：`db.js`(2605) / `index.js`(1848) / `llm.js`(1383) / `capabilities/executor.js`(1101)。新增逻辑优先外移到新文件，不要继续堆。
3. **nudge 子系统爆炸半径最大**（`llm.js` L902-970 多套启发式叠加）。回归症状 = "模型自言自语、用户收不到回复"。改这里**必须**补/跑相关测试。
4. 文档 §4.3/§9 把"协议兜底"误归到 `tool-protocol.js`，实际在 `llm.js`（见上表）。引用时以代码为准。

## 工作约定

- **不可变优先**：返回新对象，不就地改。
- **错误必须显式处理**，UI 层给友好消息，不静默吞。
- **测试**：`src/test-*.js`，`node:assert/strict` + 纯 `node` 跑。改了某模块就跑对应 `test-*.js`。smoke：`npm run smoke:tools|brain-ui|social`。
- **提交信息**：中文亦可（历史都是中文）。conventional 前缀：feat/fix/refactor/docs/test/chore/perf/ci。
- **不要碰** `package.json` 里 `electron-builder` 的 win/nsis 配置，除非明确要改发布流程。
