---
title: LLM reply protocol markers leaked into the response SSE event (dual turn-engine sanitization gap)
date: 2026-07-29
category: logic-errors
module: llm-reply-delivery
problem_type: logic_error
component: assistant
symptoms:
  - "Protocol markers ([MOOD], [SET_TASK], [RECALL], [UPDATE_PERSONA]) leaked into the response SSE event's content field"
  - "callLLM tool-loop return path emitted raw text without sanitization"
  - "runPiTurn worker 'end' message resolved with raw content (no sanitization) for pi turn-engine configs (e.g. MiniMax)"
root_cause: logic_error
resolution_type: code_fix
severity: low
related_components:
  - pi-turn-engine
  - runtime-markers
tags: [llm-reply-delivery, sanitization, sse-events, protocol-markers, pi-turn-engine, dual-engine]
---

# LLM reply protocol markers leaked into the response SSE event (dual turn-engine sanitization gap)

## Problem

BaiLongma's assistant reply pipeline selects one of two turn engines at runtime. In `src/index.js:1512` the dispatch is `const turnEngine = usePi ? piMod.runPiTurn : callLLM`, where `callLLM` lives in `src/llm.js` and `runPiTurn` lives in `src/pi/turn-engine.js` and drives the model inside a forked system-node worker (`src/pi/worker.mjs`; the Pi SDK cannot run in Electron's node — see the electron-runtime-isolation note at the top of `src/pi/turn-engine.js`).

The system has an invariant: "users never see protocol markers." The five text protocol markers (`[MOOD: x]`, `[SET_TASK]`, `[RECALL]`, `[CLEAR_TASK]`, `[UPDATE_PERSONA]`) are parsed for runtime side-effects and then stripped from any text that reaches a user-visible surface. The single source of truth for that parsing/stripping is `src/runtime/markers.js` — `parseMarkers` (`src/runtime/markers.js:108`), `stripMarkers` (`src/runtime/markers.js:130`), and the combined delivery sanitizer `sanitizeAssistantReplyForDelivery` (`src/runtime/markers.js:142`).

The defect: the `response` SSE event was emitting marker-laden content. `src/index.js:1615` binds `const response = llmResult.content`, and `src/index.js:968` calls `emitEvent('response', { sessionRef, label, content })` with that value untouched. When the active engine returned `content` without first passing it through `sanitizeAssistantReplyForDelivery`, the markers leaked into the `response` event payload — an invariant violation even though no chat bubble showed them.

## Symptoms

- The `response` SSE event's `content` field carried raw protocol markers (e.g. `[MOOD: playful]\n...`), observed via SSE inspection / telemetry on the MiniMax + Pi engine path.
- `protocol_violation` telemetry — which reads `response.slice(0, 500)` at `src/index.js` (`console.warn('[protocol fallback] ...')` and the `protocol_violation` emit) — saw marker-prefixed text, polluting the violation signal.
- No visible corruption in the chat bubble itself: the user-facing `message` SSE event flows through `src/runtime/delivery.js:287` (`const cleanedContent = content == null ? '' : sanitizeAssistantReplyForDelivery(content)`), so the bubble stayed clean and the bug was latent.
- On this machine every reply used the Pi engine (MiniMax provider), so the leak reproduced on 100% of turns, not intermittently.

## What Didn't Work

1. **Assumed it was a `markers.js` regex bug.** Unit-tested `stripMarkers` against the exact leaked text. Stripping worked perfectly — the regexes (`MOOD_STRIP` at `src/runtime/markers.js:35`, `SET_TASK_STRIP`, etc.) removed every marker. The library was correct; it simply was not being called on this code path.

2. **Assumed `callLLM`'s tool-loop return was the only culprit and "fixed" it.** Patched `src/llm.js:1683`. The leak persisted. A diagnostic `console.log` added at that return **never printed**, proving `callLLM` was not even being reached on the failing turns.

3. **Missed the dual-engine dispatch.** The realisation came from re-reading `src/index.js:1512` (`usePi ? runPiTurn : callLLM`): this machine runs MiniMax via the Pi engine, so every reply bypassed `callLLM` entirely and resolved through `src/pi/turn-engine.js:114` (`turn.resolve({ content: m.content || '' })`) — a path with zero sanitization. The `callLLM` patch at line 1683 was correct but irrelevant for this machine; the Pi resolve point was the actual leak.

This dead-end cost the most time. The lesson embedded below (sanitise at the convergence point) is the direct response to it.

## Solution

Two files changed (commit `9227de0` on branch `rebuild/on-upstream`, unmerged as of this writing — SHA may be rewritten on merge). Both now route the resolved content through `sanitizeAssistantReplyForDelivery` before it can become `llmResult.content`.

### 1. `src/llm.js` — tool-loop return path

`callLLM` already sanitised its two normal return points: `src/llm.js:323` (`content: sanitizeAssistantReplyForDelivery(fullContent)` on the abort path) and `src/llm.js:349` (the final non-abort return). But the tool-loop path at `src/llm.js:1683` returned raw `allContent`:

**Before:**
```js
// src/llm.js:1683
return { content: allContent, toolResult: lastToolResult, aborted, delivered }
```

**After:**
```js
// src/llm.js:1683
// 工具循环路径返回的 allContent 未经清洗（正常结束路径 323/349 已各自 sanitize）。
// 统一补一次：剥 <think>、协议标记（[MOOD]/[SET_TASK]/...）、loose internal prelude，
// 保证 response 事件正文与正常路径一致、用户绝不看到协议标记。
return { content: sanitizeAssistantReplyForDelivery(allContent), toolResult: lastToolResult, aborted, delivered }
```

This closes the leak for any turn that runs the `callLLM` engine and exits via the tool loop.

### 2. `src/pi/turn-engine.js` — worker resolve boundary

The Pi engine runs the model in a forked **system-node** child process (`src/pi/worker.mjs`). That worker cannot `import` from `src/runtime/markers.js` (separate process, Electron-runtime-isolated), so sanitisation must happen on the main-process side at the IPC resolve boundary. Added the import and wrapped the resolved content:

**Before:**
```js
// src/pi/turn-engine.js (case 'end')
turn.resolve({ content: m.content || '' })
```

**After:**
```js
// src/pi/turn-engine.js (new import)
import { sanitizeAssistantReplyForDelivery } from '../runtime/markers.js'

// src/pi/turn-engine.js (case 'end')
// 与 src/llm.js callLLM 对齐：返回前剥 <think>、协议标记、loose internal prelude，
// 保证 response 事件正文干净。（worker 在系统 node 子进程，无法直接 import markers，
// 故在主进程这一侧统一清洗。）
turn.resolve({ content: sanitizeAssistantReplyForDelivery(m.content || ''), toolResult: null, aborted: !!m.aborted, delivered: !!m.delivered })
```

The main process owns the markers import; the worker just ships raw `m.content` over IPC and the main process cleans it the instant it resolves the turn promise.

## Why This Works

After both changes, `llmResult.content` is guaranteed clean **before** it reaches the convergence point at `src/index.js:1615` (`const response = llmResult.content`), regardless of which engine produced it:

- `callLLM` normal path → sanitised at `src/llm.js:349`.
- `callLLM` tool-loop path → sanitised at `src/llm.js:1683`.
- `callLLM` abort path → sanitised at `src/llm.js:323`.
- `runPiTurn` → sanitised at `src/pi/turn-engine.js` (case `'end'` resolve).

From `src/index.js:1615` onward, `response` is marker-free, so `emitEvent('response', { content })` at `src/index.js:968` and the `protocol_violation` telemetry both see clean text. The user-facing `message` path was already independently defended by `src/runtime/delivery.js:287`, so the chat bubble's cleanliness is now belt-and-suspenders rather than the only line of defence.

Verification on MiniMax/Pi: sent messages that force the model to emit `[MOOD: playful]`. Before the fix, `response` event content was `[MOOD: playful]\n...`. After the fix, it is clean (`今天...`) with no `[MOOD]` leak.

## Prevention

The core lesson is structural, not regex-shaped: **when a codebase has multiple implementations of the same conceptual operation (here, two turn engines), any cross-cutting concern (sanitisation, redaction, telemetry-shaping) must be applied at the convergence point where the results rejoin — not assumed to be handled inside each branch.**

Here the convergence point is `src/index.js:1615`, `const response = llmResult.content` — the single place where both `callLLM` and `runPiTurn` outputs become "the reply." Concrete strategies, in order of robustness:

1. **Sanitise once at the convergence point.** The most durable fix is to strip markers at `src/index.js:1615` (e.g. `const response = sanitizeAssistantReplyForDelivery(llmResult.content)`) so neither engine has to remember. This makes the invariant a property of the caller, not a discipline each engine must independently maintain. The current per-engine fix is correct but requires every future engine to re-learn the rule.

2. **Force every engine through one return helper.** If convergence-point sanitisation is undesirable (e.g. an engine legitimately needs raw markers downstream), expose a single `resolveTurnContent(raw)` helper that both `callLLM` and `runPiTurn` must call, and lint/forbid returning a bare `content` field from a turn engine. New engines get compliance for free.

3. **Treat "the diagnostic never printed" as a signal about dispatch, not about the line.** When a targeted fix at a suspected return point has zero effect, the first hypothesis should be "execution never reached this branch" — re-confirm which branch is live (here, `usePi` at `src/index.js:1512`) before iterating on the patch. This dead-end would have been avoided by checking the engine dispatch before editing `src/llm.js:1683`.

4. **Add a regression assertion on the SSE payload, not just the chat bubble.** The leak stayed latent because the only sanitisation in the hot path was on the `message`/delivery route (`src/runtime/delivery.js:287`). A test that asserts the `response` event's `content` is marker-free (parsing the emitted event, not the rendered bubble) would have caught both engine paths at once and prevented the "users never see markers" invariant from silently depending on which surface a downstream component happened to read.

## Related Issues

- `docs/plans/2026-07-15-001-refactor-rebuild-on-upstream-plan.md` — the U5 unit wired the Pi turn-engine into `src/index.js` `runTurn` via the `turnEngine` flag (default `'llm'`, Pi path via lazy import of `runPiTurn`). This is the origin of the dual turn-engine architecture the bug spans; it documents *why* two parallel return paths exist but does not mention reply-marker sanitization.
