# Plan: 配置驱动的 CLI 工具调用 — gbrain 白名单 MVP（milestone #1）

**Source PRD**: `.claude/prds/cli-tool-invocation.prd.md`
**Selected Milestone**: #1 — gbrain 可调（白名单 MVP）
**Complexity**: Medium（复用既有 exec_command runner + tool-policy + schemas 模式；但需先实测 gbrain 形态）

## Summary
给 agent 一个**配置驱动的 CLI 白名单**调用入口 `run_cli({cmd, args})`：runtime 校验 `cmd` 必须在白名单内（首版只 `gbrain`），否则拒绝；放行后**复用 `exec_command` 既有 shell runner**（沙箱 / 审计 / 超时 / 输出截断）。白名单（CLI 名 + 描述）注入到 `run_cli` 的工具描述里，让模型**发现**本机有哪些 CLI 可用（直击 PRD 痛点#2"模型不知道装了哪些"）。`gbrain --help` 作为 Task 0 先实测，落定参数/截断形态再写代码。

## 设计决策（落实 PRD open question #1，grounded）
- **形态选 (b) 通用 `run_cli` + 声明式白名单**（不选 (a) 每 CLI 一个命名工具）：加 CLI = 加一条配置，零代码，最契合"可配置"+ M2 可扩展；"模型不知装了哪些"靠**把白名单名+描述拼进 `run_cli` 的 description** 解决。
- **复用 exec_command runner**：`run_cli` handler 校验白名单后，调同一个 shell 执行函数（沙箱/审计/超时/截断），不重造。
- **白名单强制**：镜像 `tool-policy.js evaluateToolPolicy` 的拒绝语义——非白名单 `cmd` 直接 `{ok:false, error:'cli not in whitelist'}`，不执行。
- **与 exec_command 边界**：`exec_command` = 任意 shell（全开，已有）；`run_cli` = 白名单受限（新增）。两者并存，`run_cli` 是"逐步放开本地能力"的安全档。

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| 工具 schema 形状 | `src/capabilities/schemas/shell.js:5` `exec_command`（OpenAI `{type:'function',function:{name,description,parameters}}`） | `run_cli` schema 同形：`{cmd, args}` |
| 工具派发 | `src/capabilities/executor.js:131` `executeToolUnchecked` 的 `switch(name)` | 加 `case 'run_cli'` → handler |
| shell 执行 runner | `src/capabilities/executor.js:149` `case 'exec_command'` 调用的执行函数 | `run_cli` 放行后复用同一 runner（沙箱/审计/超时/截断） |
| 策略/拒绝 | `src/capabilities/tool-policy.js:75` `evaluateToolPolicy` 返回 `{allowed,risk,reason}` | 白名单校验同语义：越界 `{ok:false,...}` |
| 配置读取 | `src/config.js:688` `getMinimaxKey` / `getWebSearchCredentials`（读 config.json 块 + env 兜底） | CLI 白名单 getter 同模式 |
| 动态工具注册（参考） | `src/capabilities/marketplace/index.js:108` `installTool`（registry name→{schema,execute}） | 参考其注册思路，但**不用其任意 JS code**（不安全）——本方案声明式 |
| 测试 | `src/test-*.js`（`node:assert/strict` + 纯 `node`） | `test-cli-whitelist.js` 同风格 |

## Files to Change
| File | Action | Why |
|---|---|---|
| `src/cli-whitelist.js` | CREATE | 白名单加载 + getter（默认含 gbrain）；纯逻辑可单测 |
| `src/capabilities/schemas/cli.js` | CREATE | `run_cli` schema（description 运行时拼入白名单名+描述） |
| `src/capabilities/schemas.js` | UPDATE | 合并 `cliSchemas` 进 `TOOL_SCHEMAS`（镜像现有域合并） |
| `src/capabilities/executor.js` | UPDATE | 加 `case 'run_cli'` → 校验白名单 → 复用 exec runner |
| `src/index.js` | UPDATE | 把 `run_cli` 加入默认/per-turn 工具集（`resolveTurnTools` 能取到） |
| `src/test-cli-whitelist.js` | CREATE | 白名单强制 + 配置可扩展 单测 |
| `config.json`（userData，非仓库模板） | UPDATE（运行时） | 顶级 `cli_whitelist: [{name:'gbrain', description}]`（仅当需持久化时；MVP 也可先用代码默认） |

## Tasks

### Task 0: gbrain 实测（落实 open Q #2，先于编码）
- **Action**: `which gbrain` + `gbrain --help`（及主子命令 `--help`）。记录：子命令列表、参数形态、是否长任务、输出量级、有无写/删等破坏性子命令。
- **Mirror**: 无（这是探测未知）。
- **Validate**: 产出"子命令/参数/输出/破坏性"小结，据此定 `run_cli` schema 描述与截断阈值；若 gbrain 未装/无 CLI，记录并回流 PRD（M1 可能要先 `gbrain` 安装/路径）。

### Task 1: 白名单配置 + 纯逻辑加载器
- **Action**: `src/cli-whitelist.js`：`DEFAULT_WHITELIST=[{name:'gbrain',description:'本地知识库 gbrain'}]`；`loadCliWhitelist()` 读配置（默认 + 配置覆盖，镜像 getMinimaxKey 的 config.json 块 + 兜底）；`isCliAllowed(name)`、`listAllowedClis()`。
- **Mirror**: `src/config.js:688` getMinimaxKey 读取模式。
- **Validate**: `node src/test-cli-whitelist.js` —— isCliAllowed('gbrain')=true、('curl'/'rm')=false；配置加一个 CLI 后能列出。

### Task 2: `run_cli` schema + 派发 + 复用 runner
- **Action**: `schemas/cli.js` 定义 `run_cli`（参数 `{cmd, args}`，`args` 为字符串/数组）；description 运行时拼入 `listAllowedClis()` 的名+描述（让模型发现可用 CLI）。`executor.js` 加 `case 'run_cli'`：`if(!isCliAllowed(cmd)) return toolJson({ok:false,error:'cli not in whitelist'})`；否则调 exec_command 既有 runner（传 `${cmd} ${args}`，复用沙箱/审计/超时/截断）。
- **Mirror**: `schemas/shell.js:5` exec_command schema；`executor.js:149` exec dispatch + runner。
- **Validate**: `node --check`；mock runner 单测：白名单内放行、越界拒绝。

### Task 3: 让模型发现 + 加入工具集
- **Action**: `schemas.js` 合并 `cliSchemas`；`index.js` 把 `run_cli` 加进默认工具集，使 `resolveTurnTools`/`injection.tools` 能带上它（模型每轮可见）。
- **Mirror**: 现有域 schema 合并（`schemas.js:17`）；工具集默认项。
- **Validate**: 启动 app，`GET /settings` 或日志确认 `run_cli` 进入工具列表；发一条"列出你可用的 CLI"消息，模型应能说出 gbrain。

### Task 4: 截断 / 审计 / 安全对齐
- **Action**: 确认 `run_cli` 复用的 runner 输出截断、审计日志（writeToolAuditLog）、超时与 exec_command 一致；首版 gbrain 偏只读调用（若实测有破坏性子命令，在 description 里警告 + 记 open question 给 M2 细粒度拦截）。
- **Mirror**: exec_command 的截断/审计/超时。
- **Validate**: 大输出 gbrain 调用被截断；审计日志有 run_cli 记录。

## Validation
```bash
node src/test-cli-whitelist.js            # 白名单强制 + 可配置扩展
node --check src/cli-whitelist.js src/capabilities/schemas/cli.js src/capabilities/executor.js src/index.js
node src/test-*.js                        # 现有单测零回归
npm run smoke:tools                       # 工具链冒烟零回归
# app 级：启动后发"用 gbrain 查 …"→ agent 自主调 run_cli({cmd:'gbrain',args:...}) 拿到结果；
#         发"用 curl …"→ run_cli 拒绝（非白名单）
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| gbrain 形态未实测 → schema/截断返工 | 中 | Task 0 先做，落定再编码 |
| 白名单配置位置/加载与现有 config 机制冲突 | 中 | 镜像 getMinimaxKey；MVP 可先用代码默认白名单，配置化留 Task 1 内可选 |
| `run_cli` 与 `exec_command` 边界混淆（模型乱用） | 中 | description 明确二者用途；run_cli 描述列出白名单 CLI |
| gbrain 大输出撑爆上下文 | 中 | 复用 exec_command 截断 |
| gbrain 有破坏性子命令被误调 | 中 | 首版偏只读 + description 警告；细粒度拦截 M2+ |
| 工具未进 per-turn 工具集 → 模型发现不了 | 中 | Task 3 显式加入 + app 级验证模型能说出 gbrain |

## Acceptance
- [ ] Task 0：gbrain 形态已实测并记录（子命令/输出/破坏性）
- [ ] `run_cli` 工具存在且模型每轮可见（能说出可用 CLI 含 gbrain）
- [ ] 白名单内（gbrain）调用放行并拿到真实结果；白名单外（如 curl/rm）100% 被拒
- [ ] 复用 exec_command 的沙箱/审计/超时/截断（不弱于现状安全约束）
- [ ] `test-cli-whitelist.js` 绿；现有 test-*.js + smoke:tools 零回归
- [ ] TICK 实测：agent 自主调通 gbrain ≥1 子命令

---
*M1 是 Medium。Task 0（gbrain 实测）必须先做——它决定 schema 描述与截断阈值，也验证 gbrain 真的可用。执行前需用户确认。*
