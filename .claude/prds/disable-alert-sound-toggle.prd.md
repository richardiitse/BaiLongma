# 回复提示音关闭开关

## Problem
Jarvis 回复时会响一个合成提示音 `playJarvisAlert()`（`src/ui/brain-ui/chat.js:111`），在 `beginLiveJarvisMsg`（L479）与 `appendMessage`（role=jarvis，L190）两处硬编码 `alert=true` 触发，**用户无法关闭**。自用者有时觉得打扰，但现状只能改源码才能静音——没有一个设置开关。代价：要么忍着提示音，要么改代码。

## Evidence
- 观察：`playJarvisAlert()`（`chat.js:111`）硬编码触发，无任何关闭途径；本会话已定位（自用 n=1）。
- Assumption — 需通过实际用开关几天验证"关掉后确实更舒服"。

## Users
- **Primary**：项目自用者（operator）——想按需静音 Jarvis 回复提示音。
- **Not for**：想关开机自检音、或调音色/音量的人（out of scope）。

## Hypothesis
We believe **在设置页加一个"关闭提示音"开关（默认开）gate `playJarvisAlert`** will **让自用者无需改代码就能静音回复提示音** for **我自己**. We'll know we're right when **开关关 → 下次 Jarvis 回复不响；开 → 恢复响；刷新/重启后设置保持**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| 持久生效 | 刷新/重启后开关状态保持 | 改状态 → reload → 验证 |
| 静音有效 | 关时 Jarvis 回复不响 `playJarvisAlert` | 关 → 发消息触发回复 → 听/看日志 |
| 默认不变 | 默认开，未触碰开关时仍响 | 全新状态首次启动 |

## Scope
**MVP** — 设置页一个"关闭提示音"开关；**关**时 `beginLiveJarvisMsg`（L479）与 `appendMessage`（L190）两处跳过 `playJarvisAlert`；**默认开**（保留现状）；持久化（机制留给 `/plan`）。

**Out of scope**
- 开机自检音（`app.js:1500`）—— 范围只到回复提示音。
- tts-fx 语音特效 —— 那是语音处理，不是提示音。
- 其他音效 / 音量调节。

## Delivery Milestones
<!-- 业务结果，不是工程任务。/plan 把每个 milestone 展开成实现计划。 -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | 提示音开关可用 | 设置页有"关闭提示音"开关：关时回复不响、开时恢复、刷新/重启后状态保持 | in-progress | .claude/plans/disable-alert-sound-toggle.plan.md |

## Open Questions
- [ ] 持久化机制：`localStorage`（仿 `tts-fx.js` 的 `jarvis.ttsfx.*` 先例）vs `config.json` + `/settings` API（跨设备同步）。
- [ ] 开关放设置页哪个分区。

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 持久化选错（localStorage 不跨设备 / config 需后端改动） | 低 | 低 | `/plan` 看 `tts-fx.js` 的 localStorage 先例，优先复用 |
| 两个调用点只改一个 → 漏响 | 中 | 低 | `/plan` 两处都 gate + 测试覆盖 |
| 默认值设反 → 现状被改变 | 低 | 低 | 显式默认 `true`（保留现状）+ 测试断言 |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
