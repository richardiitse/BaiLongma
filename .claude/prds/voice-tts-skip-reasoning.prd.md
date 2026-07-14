# Voice TTS 跳过推理内容（语音回合只读回答）

## Problem
用语音和 Jarvis 对话时，TTS 会把 DeepSeek reasoner 的整段长链推理也朗读出来，用户被迫听完一大段"内心独白"才等到真正的回答。这拖长了每次语音回合的耗时、消耗注意力，且操作者已长期忍受。留在原地不解决的代价：语音对话这条主交互路径体验持续劣化，几乎等同于语音模式不可用。

## Evidence
- 操作者长期观测：每次语音回合，整段 `reasoning_content` 都被朗读（原话"忍很久了""整段思考都读"）。
- 问题域确证：该路径为语音对话回合（连续 / PTT 模式下自动朗读回复），而非点消息上的「🔊 朗读」按钮。
- Assumption — needs validation via {/plan 阶段的一条「reasoning_content 非空」测试回合，断言"零推理文本进入 TTS"}。

## Users
- **Primary**: 操作者本人——通过语音（连续 / PTT）与 Jarvis 对话、依赖 TTS 听回复的人。
- **Not for**: 非语音「🔊 朗读」按钮的用户（该路径读的是已组装好的最终文本，不在本问题范围）；希望"听见 AI 思考过程"的任何场景（明确不做）。

## Hypothesis
We believe **把推理/思考内容从语音回合的"朗读文本源"中排除** will **让 DeepSeek 的长链推理不再被 TTS 读出来** for **用语音对话的操作者**.
We'll know we're right when **一次语音回复里即便包含大段 `reasoning_content` / `<think>`，TTS 也只朗读回答本身，思考全程不可闻。**

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| 推理内容朗读泄漏 | 0 | 一次 `reasoning_content`/`<think>` 非空的语音回合中，进入 TTS 的文本里推理内容 = 0（断言/测试可验证） |
| 回答仍正常朗读（不回归） | 回答部分照常合成播放 | 同一回合的回答部分被正常朗读、响应性不劣化于现状 |
| 屏幕思考显示 | 不变 | 思考动画/文字仍在屏幕显示，仅对语音静音（看见但不读） |

## Scope
**MVP** — 语音回合里，进入 TTS 的文本必须排除 `reasoning_content` 与 `<think>…</think>` 内容；回答部分仍**按句流式朗读（边生成边读）**，保持响应性。屏幕上的思考显示与语音解耦，保持可见。

**Out of scope**
- 改变 reasoning 是否开启（保持现状 always-on）。
- 屏幕思考显示本身（保留可见，仅对语音静音）。
- 非语音「🔊 朗读」按钮（已是最终文本，非反馈路径）。
- 工具调用旁白 / barge-in 抢话打断逻辑 / TTS provider 切换。
- 边角：模型把推理塞进普通 `content`（既无 `reasoning_content` 字段、也无 `<think>` 标签）的情况——留待 /plan 验证是否真实存在、是否需要扩展。

## Delivery Milestones
<!-- 业务产出，不是工程任务。每个里程碑由 /plan 转成实现计划。 -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | 语音回合 TTS 排除推理内容 | 语音回复只朗读回答、思考不再可闻，回答仍按句流式朗读，屏幕思考显示不回归 | in-progress | [.claude/plans/voice-tts-skip-reasoning.plan.md](.claude/plans/voice-tts-skip-reasoning.plan.md) |

## Open Questions
- [ ] 边角：是否存在模型把推理写进普通 `content`（无 `reasoning_content` 字段、无 `<think>` 标签）？若存在，纯结构过滤兜不住——/plan 时核实并决定是否扩展过滤策略。
- [ ] 推理被过滤后，"思考结束 → 回答开始"的切换处是否会出现死寂间隙需要补偿信号？—— /plan 时评估（参考现有 UI 思考流切换信号的处理方式）。

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 流式过滤误伤回答文本（把回答误判为思考切掉） | Low | High | 过滤边界只用明确结构信号（`reasoning` 字段 / `<think>` 闭合），不靠关键词猜测；/plan 补针对性测试覆盖 |
| 解耦不彻底，连带把屏幕思考显示也隐藏了 | Low | Med | MVP 明确"仅静音、不隐藏"；验收核对屏幕思考仍可见 |
| 某模型推理无结构标记，过滤失效 | Med | Med | 已列为 open question，/plan 先核实再决定是否扩展 |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
