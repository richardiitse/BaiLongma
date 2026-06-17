# Plan: Pi SDK 最小闭环 PoC（milestone #1）

**Source PRD**: `.claude/prds/pi-sdk-turn-engine-migration.prd.md`
**Selected Milestone**: #1 — Pi SDK 最小闭环 PoC
**Complexity**: Medium（代码量小，但解决一个高不确定性的可行性问题 + provider 适配）

## Summary
一个**独立 spike 脚本**（不并入 BaiLongma 主循环），用 Pi SDK 跑通：1 个 BaiLongma 工具（`search_memory` 经 `executeTool`）+ ACI 经 `systemPromptOverride` 注入 + minimax provider。**首要目标不是"跑漂亮"，而是回答核心未知：`systemPromptOverride` 是否每轮重新求值**（决定 ACI 每轮注入是否可行 = 决定整个迁移可行性）。PoC 通过后才有 M2 质量对比、M3 全量迁移。

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Pi session 创建 | pi.dev/docs `createAgentSession` + `SessionManager.inMemory()` | 最小 inMemory 会话 |
| 自定义工具 | pi.dev/docs `defineTool({name,parameters,execute})` | execute 里调 BaiLongma `executeTool(name,args,context)` |
| system prompt | pi.dev/docs `DefaultResourceLoader({systemPromptOverride: () => ...})` | 返回 ACI 字符串（调 `runInjector` 或 stub） |
| 自定义 provider | pi.dev/docs custom `models.json`（OpenAI 兼容） | 配 minimax `api.minimax.chat/v1` + key |
| ACI 注入 | `src/memory/injector.js` `runInjector({message,state})` | 复用产出 ACI 上下文串 |
| 工具执行 | `src/capabilities/executor.js:268` `executeTool(name,args,context)` | 程序化跑一个工具 |
| 测试 | `src/test-*.js`（node:assert + 纯 node） | PoC 自检用 assert |

## Files to Change
| File | Action | Why |
|---|---|---|
| `package.json` | UPDATE | 加 `@earendil-works/pi-coding-agent` 依赖 |
| `sandbox/pi-poc.mjs` | CREATE | PoC spike 脚本（独立、可删） |
| `sandbox/pi-custom-models.json` | CREATE | minimax 作 Pi 自定义 provider 配置 |

## Tasks

### Task 1: 装 Pi SDK + 配 minimax provider
- **Action**: `npm i @earendil-works/pi-coding-agent`；写 `sandbox/pi-custom-models.json`，把 minimax 配成 OpenAI 兼容自定义 provider（baseURL `api.minimax.chat/v1`、model `MiniMax-M2.7`、key 从 `MINIMAX_API_KEY`）。
- **Mirror**: pi.dev/docs "Custom Models/Custom Providers" + `ModelRegistry.create(authStorage, modelsJsonPath)`。
- **Validate**: `node -e` 能 `getModel`/`modelRegistry.find('minimax', ...)` 拿到模型。

### Task 2: PoC 脚本——session + customTool + systemPromptOverride
- **Action**: `sandbox/pi-poc.mjs`：
  - `createAgentSession({ sessionManager: SessionManager.inMemory(), authStorage, modelRegistry, resourceLoader })`；
  - `resourceLoader` 用 `DefaultResourceLoader({ systemPromptOverride: () => <ACI串> })`，ACI 串里放一个**会变的标记**（如计数器/时间戳）用于 Task 3 的每轮测试；
  - 1 个 `defineTool` 把 `search_memory` 包起来，execute 调 `executeTool('search_memory', args, ctx)`；
  - `subscribe` 打印 `text_delta` + `tool_execution_*` 事件。
- **Mirror**: pi.dev/docs Complete Example。
- **Validate**: `node sandbox/pi-poc.mjs` 能跑完一次 prompt 并打印流式 + 工具调用。

### Task 3: ⚠️ 核心可行性测试——systemPromptOverride 是否每轮求值
- **Action**: 让 `systemPromptOverride` 返回带**每轮递增标记**的串；连发 2 条 prompt；第 2 轮**让模型复述 system prompt 里的标记**（或用 Pi 的 `session.agent.state.systemPrompt` 读取）。判断第 2 轮看到的是新标记还是首轮旧值。
- **Mirror**: 无先例（这是要验证的未知）；记录结论。
- **Validate**:
  - **若每轮更新** → ✅ ACI 每轮注入可行，迁移路线成立，进 M2。
  - **若首轮缓存** → ❌ systemPromptOverride 不可每轮注入；记录 fallback（每轮把 ACI 作为 user/system message 前缀注入，或每轮 newSession），写进 PoC 报告，回流 PRD 重判方案。

### Task 4: PoC 报告 + 决策
- **Action**: 汇总 PoC 结论（systemPromptOverride 行为、工具调用是否成功、minimax 经 Pi 是否通、观察到的工具调用质量），写一段结论到 plan 末尾 / 回流 PRD open question。
- **Validate**: 产出明确"可行/不可行 + 理由 + 下一步"。

## Validation
```bash
npm i @earendil-works/pi-coding-agent
node sandbox/pi-poc.mjs        # 跑 2 轮：打印流式 + 工具调用 + 每轮 systemPromptOverride 标记对比
# 期望：1 次工具调用成功；明确 systemPromptOverride 每轮行为（核心结论）
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| **systemPromptOverride 首轮缓存** → ACI 每轮注入失败（迁移核心机制） | 高 | **Task 3 就是测这个**；若失败，记录 fallback（每轮 message 前缀注入 / 每轮 newSession），不强行 |
| minimax 不被 Pi 内置支持 → 需 custom provider | 中 | Task 1 custom models.json 配 OpenAI 兼容端点 |
| `executeTool` 需 BaiLongma 运行时上下文（db/state/事件总线） | 中 | PoC 传最小 ctx 或 stub；记录真实接入需的依赖 |
| Pi SDK ESM 导入 / Electron node 环境兼容 | 低 | 纯 node 跑 PoC 先验证；ESM 原生支持 |
| 工具调用质量假设（< Pi）PoC 没测出来 | 中 | M2 专门做同任务对比；PoC 只看"能跑通" |

## Acceptance
- [ ] Pi SDK 装好，minimax 经 custom provider 能被 Pi 调用
- [ ] PoC 跑通 1 次 turn：流式输出 + `search_memory` 工具被调用 + 返回
- [ ] **`systemPromptOverride` 每轮行为已明确判定**（可行 ✅ 或不可行 + fallback）—— 核心
- [ ] PoC 报告给出"全量迁移可行/不可行 + 理由"，回流 PRD open question #1
- [ ] spike 独立于主循环，BaiLongma 现有行为零回归

---
*PoC 结论（源码核查，2026-06-14）：*
- *systemPromptOverride 每轮行为 = **一次性**（loader.reload() 时算一次并缓存；_rebuildSystemPrompt 只读缓存，仅工具集/扩展变更时触发，不在每轮 prompt 路径）。❌ 不能用它每轮注入 ACI。*
- *Fallback（viable）= 每轮 `session.prompt()` 前直写 `session.agent.state.systemPrompt = <本轮 ACI>`；agent.prompt()（agent-session.js:658）每轮读 state.systemPrompt。✅*
- *迁移可行性 = **可行**（经 state.systemPrompt 每轮直写，非 systemPromptOverride）。minimax 经 Pi + 真实工具调用留 M2 验证。*
