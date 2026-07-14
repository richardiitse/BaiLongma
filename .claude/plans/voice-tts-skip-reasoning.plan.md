# Plan: Voice TTS 跳过推理内容

**Source PRD**: `.claude/prds/voice-tts-skip-reasoning.prd.md`
**Selected Milestone**: #1 — 语音回合 TTS 排除推理内容
**Complexity**: Medium（代码面很小：2 个文件 ~20 行；不确定性来自"Pi SDK 是否把推理作为独立信号暴露"，Task 1 必须先确认）

## Summary
语音回合把模型推理读出来的根因不在 TTS 队列，而在 **Pi turn-engine 路径把推理流硬标成 `mode:'text'`**：`worker.mjs` 把 Pi SDK 的 delta 原样当正文转发，`turn-engine.js:97-99` 给所有流事件写死 `mode:'text'`，于是渲染端的 `data.mode === "text"` 闸门（`app.js:1301`）把推理放进了 `feedStreamingTTS`。经典 `llm.js` 路径用 `mode:'think'` 正确包夹推理，不漏。修法：让 Pi 路径对齐 `llm.js` 的推理流契约——推理标 `mode:'think'`，渲染端既有闸门即可拦截，**无需改渲染端**。

## Notes（Task 1 诊断结论 — 修订了上面的初始假设）
- **实际激活路径 = 经典 `llm.js`**（读 userData 运行时配置：`turnEngine:"llm"`、`provider:"minimax"`、`model:"MiniMax-M3"`）。Pi 路径未启用 → **不动 `worker.mjs`/`turn-engine.js`**。
- **真实根因**（经一次性 live 探针确认）：MiniMax-M3 经 OpenAI 兼容接口把推理以 `<think>…</think>` **内联在 `content`** 里流式返回（既不是 `reasoning_content` 字段，也不是 `<thinking>`）。`llm.js` 本有 `<think>` 解析器(L197-227)，但 L188-193 一段 **DeepSeek 专用"早关 think 流"**（`reasoning_content` 字段→`content` 字段切换时关流）在内联 `<think>` 场景会于**首个 `<think>` chunk 之后误关**，`thinkDone=true`，后续推理全部跌落到 `mode:'text'` → 被朗读。
- **实际修复（落在 `src/llm.js`，非 Pi 桥）**：加 `thinkFromField` 标志——`reasoning_content` 字段式(DeepSeek)=`true` 走原早关；内联 `<think>` 标签式(minimax)=`false` **不走**早关，think 流由 `</think>` 闭合。另加测试缝 `_setClientForTest`/`_clearClientForTest` + 导出 `streamOnce`。
- **Pi 路径遗留（本次不做）**：`worker.mjs:84` 只转发 `text_delta`、丢弃 `thinking_delta`——Pi 路径下推理既不显示也不朗读（是显示缺口，非朗读 bug）。超出本 PRD 范围，留作后续。
- **测试**：`src/test-llm-stream-reasoning.js`（合成客户端，两条路径均通过）。

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| 推理流契约（要复刻到 pi 桥） | `src/llm.js:172-193` | `reasoning_content` → `onStream({event:'start',mode:'think'})` → `chunk` → 回答开始时 `end`，再以 `mode:'text'` 重开 |
| onStream→客户端转发契约 | `src/index.js:1411-1427` | `plainReply`/`speak` 仅 `mode==='text'` 才真；渲染端据此分流（**已正确，勿动**） |
| 渲染端闸门（已就位） | `src/ui/brain-ui/app.js:1282-1311` | `stream_chunk` 只在 `data.mode==='text' && liveReplyActive` 才喂 TTS；think 仅 `bumpTokens`。证明源头 `mode` 标对即足够 |
| 朗读文本剥离（单一权威） | `src/capabilities/tools/media.js:67-80`、`app.js:1818-1840` | `stripMarkdownForSpeech` / `cleanStreamText` 既有的 spoken-text 卫生约定（非本次泄漏点，保持一致即可） |
| 测试约定 | `src/test-*.js` | `node:assert/strict` + 纯 `node` 跑，无框架 |

## Files to Change
| File | Action | Why |
|---|---|---|
| `src/pi/worker.mjs` | UPDATE | 区分 Pi SDK 的推理增量与正文增量，发带 `reasoning:true`（或独立 `stream_think` 类型）的消息，而非把 delta 一律当正文 |
| `src/pi/turn-engine.js` | UPDATE | `97-99` 行：把 worker 的推理信号翻译成 `mode:'think'` 的 start/chunk/end（对齐 `llm.js:172-193`），正文仍 `mode:'text'` |
| `src/test-pi-stream-reasoning.js` | CREATE | 断言推理增量→`mode:'think'`（绝不 `text`）、正文→`mode:'text'`；模拟语音轮推理文本零进入 TTS 队列 |
| `.claude/prds/voice-tts-skip-reasoning.prd.md` | UPDATE | Milestone #1：`pending`→`in-progress`，Plan 列填本文件路径 |

**明确不改**（已知正确，动了就是回归）：`src/llm.js`、`src/ui/brain-ui/app.js` 渲染端、`src/index.js` 的 `onStream`、`src/capabilities/tools/media.js`。

## Tasks
### Task 1 — 诊断：确认激活路径 + Pi SDK 事件形状（resolves PRD open Q#1）
- **Action**: (a) 读 **userData** 运行时配置（非 repo `config.json`——见 electron-config-location），确认 `turnEngine` 与 `provider`，判定是否走 Pi 路径（Pi 仅在 `provider==='minimax'` 且 `turnEngine==='pi'` 时激活，见 `turn-engine.js:43-45`）。(b) 跑一次产生推理的语音轮，trace `worker.mjs:86` 的 `e.assistantMessageEvent.delta` 是否含推理、Pi SDK 是否另暴露推理事件/字段（如 `onReasoning`、`e.type==='reasoning'`、`isReasoning`）。
- **Mirror**: 既有 `src/test-pi-tool-bridge.js` 的调用/打桩方式。
- **Validate**: 产出"能否在源头区分推理 vs 正文"的明确结论 + 选定 Task 2 的具体字段/事件名；写进本 plan 的 Notes。

### Task 2 — 修复：Pi 桥对齐 `mode:'think'` 契约
- **Action**: 依 Task 1 结论，在 `worker.mjs` 把推理增量与正文增量分流（推理带 `reasoning:true` 或独立类型）；在 `turn-engine.js:97-99` 翻译为 `onStream({event:'start',mode:'think'})`→`{event:'chunk',mode:'think',text}`→`{event:'end'}`，正文保持 `mode:'text'`。
- **Mirror**: `src/llm.js:172-193` 的 think/text 切换与包夹顺序（思考结束→`end`→正文 `start{mode:'text'}`）。
- **Validate**: `node src/test-pi-stream-reasoning.js` 全绿；一次推理轮的事件序列为 `start{think}→chunk{think}→end→start{text}→chunk{text}→end`。

### Task 3 — 测试：覆盖三种断言
- **Action**: 新建 `src/test-pi-stream-reasoning.js`：(a) 推理增量只产生 `mode:'think'`，永不 `text`；(b) 正文增量产生 `mode:'text'`；(c) 模拟语音轮（`speak:true`）下，喂入 `feedStreamingTTS` 的文本中推理部分为 0（断言 PRD 的"泄漏=0"指标）。
- **Mirror**: `src/test-pi-tool-bridge.js` / `src/test-focus-classifier.js`（`node:assert/strict`、AAA 结构）。
- **Validate**: `node src/test-pi-stream-reasoning.js`。

### Task 4 — 端到端核验 + 回归
- **Action**: 启动应用，语音问一个会触发长推理的问题；确认 TTS 只读回答、思考动画/计数仍显示、回答仍逐句流式。再切回经典 `llm.js` 路径（`turnEngine:'llm'` 或非 minimax provider）跑一次，确认无回归。
- **Mirror**: 现有 smoke 套路 `npm run smoke:brain-ui`（渲染端路径）。
- **Validate**: 人工听测 + `npm run smoke:brain-ui` 通过；经典路径行为不变。

## Validation
```bash
node src/test-pi-stream-reasoning.js     # 新增：推理/正文分流 + TTS 零泄漏
node src/test-pi-tool-bridge.js          # 既有：pi 桥不回归
npm run smoke:brain-ui                   # 渲染端路径不回归
# 运行时听测：语音轮触发长推理 → 只读到回答
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Pi SDK 不把推理作为独立信号暴露（与正文混在同一 delta）→ 源头无法分流 | Med | Task 1 先确认；若成立，降级方案：语音轮 `thinking:'disabled'`（牺牲推理可见，但符合"不读思考"硬需求），或语音轮改走经典 `llm.js` 路径（已正确处理 `reasoning_content`）。决策记入 plan Notes |
| 读 userData 才知道激活路径（repo `config.json` 不生效，electron-config-location） | Med | Task 1 显式读 userData，不假设 repo 配置 |
| 误把正文标成 `think`（把真回答切出语音） | Low | 严格镜像 `llm.js` 边界逻辑 + Task 3 断言正文仍 `mode:'text'` |
| 经典 `llm.js` 路径回归 | Low（本不动它） | Task 4 回归听测经典路径 |

## Acceptance
- [ ] Task 1 结论写入 plan Notes（Pi SDK 是否可分流推理 + 选定字段/降级方案）
- [ ] Task 2：Pi 路径推理流 = `mode:'think'`，对齐 `llm.js` 契约
- [ ] Task 3：`test-pi-stream-reasoning.js` 全绿（泄漏=0）
- [ ] Task 4：运行时听测只读回答 + 经典路径无回归
- [ ] PRD Milestone #1 标 in-progress、Plan 列已填
- [ ] 渲染端/`llm.js`/`index.js`/`media.js` 零改动（模式已复刻，非重造）
