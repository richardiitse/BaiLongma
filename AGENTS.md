# AGENTS.md — Jarvis project guide

> **Project speed-read for any agent (Claude Code, Codex, or human) working in this repo.**
> For role-specific scope, see `.harness/agent.md` (orchestrator) and `.harness/reins/<name>/agent.md` (reins).

---

## What this project is

**Jarvis** — a continuously running **Electron desktop AI Agent** (Node + better-sqlite3 + OpenAI-compat LLM stack). v2.1.393.

It is **not** a request/response chatbot. It has:

- A **TICK-driven main loop** that stays resident, processes user messages with priority + preemption, and runs ambient exploration on idle heartbeat.
- A **focus stack** with multi-frame management, async compression, and persistence.
- A **memory system** with recognition, threading, consolidation, embedding-based recall, and FTS5 search — all local SQLite.
- A **tool executor** with sandbox, schema-per-domain, marketplace, and policy/audit hooks.
- **Brain UI** — chat + memory graph + focus thread + ACUI cards + voice panel + settings, served on `127.0.0.1:3721`.
- **Multi-channel social** — Discord + WeChat bridge feed the same main loop; replies route back by channel.
- **Voice** — cloud ASR + multi-provider TTS + local Whisper fallback.

Design philosophy: see `ACI-理念文档.md` (Anticipatory Contextual Injection — pre-execute the tool chain, warm caches, classify focus async).

## One-shot commands

| Goal | Command |
|---|---|
| Install (after Electron version change) | `npm run postinstall` |
| Run desktop app | `npm start` |
| Run backend only | `npm run start:backend` |
| Backend dev with watch | `npm run dev` |
| LAN access (full app / backend) | `npm run start:lan` / `npm run start:backend:lan` |
| Smoke (tools) | `npm run smoke:tools` |
| Smoke (Brain UI, Playwright) | `npm run smoke:brain-ui` |
| Smoke (social) | `npm run smoke:social` |
| Targeted tests | `npm run test:rule-context` / `test:complex-task` / `test:relevance` / `test:section-gate` / `test:agent-skills` / `test:config-upgrade` |
| Prompt split unit test | `node src/test-prompt-split.js` (32 assertions) |
| Memory repair (dry run / apply) | `npm run repair:memories:dry` / `repair:memories` |
| Probe config upgrade | `npm run probe:config-upgrade` |
| Build Windows installer | `rm -rf dist && NODE_OPTIONS=--max-old-space-size=4096 npm run build` |
| Publish to GitHub Releases | `npm run publish` |

Default backend port: `127.0.0.1:3721`. Electron auto-finds another port if 3721 is busy.

## Key paths (read these first)

| Path | What |
|---|---|
| `src/index.js` | TICK-driven main loop. `runTurn` is at **L854-1584** (defined at L854; wrapped by `runTurnWithWatchdog` at L1592). Don't break preemption / focus / fallback reply. |
| `src/api.js` | HTTP + SSE + WebSocket surface. Settings / memory / admin endpoints. |
| `src/queue.js` | Priority queue + `shouldPreemptFor` + AbortController-based interruption. |
| `src/ticker.js` | Idle heartbeat + ambient autonomous exploration. |
| `src/db.js` | **2605 LoC SQLite facade.** Schema, indexes, FTS5, repositories. Public exports must stay stable. |
| `src/llm.js` | OpenAI-compat streaming + retry + tool-call execution. |
| `src/prompt.js` | `buildSystemPrompt` (stable system) + `buildContextBlock` (per-round dynamic). |
| `src/memory/` | 22 files — recognizer / focus / threads / injector / consolidator / embedding / self-perception / temporal-parser / etc. |
| `src/context/` | 7 files — rule-engine, keyword-context, runtime-injector, section-gate, etc. |
| `src/capabilities/` | Tool executor + 12 schema domains (`schemas/*.js`) + per-domain tool impls (`tools/*.js`) + sandbox + marketplace + helpers. |
| `src/runtime/` | channel, messages, markers, turn-trace, verbatim, tool-protocol, tool-result-preview. |
| `src/social/` | Discord + WeChat bridge + dispatch + http + webhooks + xml. |
| `src/voice/` | cloud-asr + tts-providers + manager + whisper (Python). |
| `src/providers/` | base + minimax + registry (DeepSeek / MiniMax / OpenAI / Qwen / Moonshot / Zhipu / MiMo / custom). |
| `src/ui/brain-ui/` | Brain UI frontend (chat / graph / panels / settings / ACUI / voice panel). |
| `electron/main.cjs` + `preload.cjs` + `focus-banner-preload.cjs` | Electron host process + preload bridge + focus banner window. |
| `scripts/` | Build, smoke, probe, repair, seed, reset. |
| `sandbox/` | Agent workspace (generated files, downloads, media). Not committed. |
| `data/` | Local runtime data (SQLite DB, logs). Not committed. |

## Hard rules (any change must respect)

1. **Don't break tool JSON shapes.** Wire-level names in `src/capabilities/schemas/*.js` are public contracts.
2. **Don't break HTTP API JSON shapes.** Brain UI consumes them via `src/ui/brain-ui/api-client.js`.
3. **Don't break the system/context prompt split.** `buildSystemPrompt` returns a stable system; `buildContextBlock` is per-round. The `<context>` block prefixes the user message and is **never written back to db**.
4. **Don't refactor + change behavior in the same commit.** Per `REFACTOR-MODULE-SPLIT-PLAN.md`.
5. **Don't change UI visual design** unless explicitly scoped.
6. **Don't write real API keys to committed files.** Use `.env` (loaded by `node --env-file=.env`) or the activation page.
7. **Don't commit** `sandbox/`, `data/`, `dist/`, `voice-dist/`.

## Known issues (do not silently fix inside unrelated work)

- **`config.json` contains a plaintext Volcengine API key** — security defect. Track as a dedicated ticket; do not bundle a fix into unrelated work.
- **`dependencies` carry 11 high-severity npm vulnerabilities** — track as a dedicated security ticket; do not mass-upgrade in unrelated commits.
- **Node CLI ABI mismatch**: Electron 33 builds `better-sqlite3` against ABI 130; Node 22 CLI uses ABI 127. Tests that write to SQLite will fail under Node CLI. Document, don't fight it.
- **`brain.html` / `dashboard.html` route to 404** — pre-existing, not a regression.
- **`packaged/installed` ABI**: verified ABI 130 for `better-sqlite3` in the Windows installer. Stay at Electron 33.4.11 unless you can verify the ABI matrix.

## Team

The project has a 6-rein `.harness/` team. See `.harness/agent.md` (orchestrator) and `.harness/reins/<name>/agent.md` (each rein) for routing.

| Rein | Owns |
|---|---|
| `loop-runtime-expert` | `src/index.js`, `src/api.js`, `src/queue.js`, `src/ticker.js`, `src/runtime/*`, `src/db.js`, `src/prefetch/runner.js`, `src/events.js`, `src/control.js`, `src/paths.js`, `src/utils.js` |
| `memory-context-expert` | `src/memory/*`, `src/context/*`, `src/profile/*`, `src/prompt.js`, `src/agents/*`, `src/skills/*`, `src/llm.js`, `src/embedding.js`, `src/person-cards.js`, `src/hotspots.js` |
| `capabilities-expert` | `src/capabilities/*` (executor + tools + schemas + sandbox + marketplace + helpers), `src/capabilities/ui-components.json`, `src/runtime/tool-protocol.js`, `src/runtime/tool-result-preview.js` |
| `integrations-expert` | `src/social/*`, `src/voice/*`, `src/providers/*`, `src/config.js`, `src/identity.js`, `src/key-auto-config.js`, `src/quota.js`, `src/weather.js`, `src/geo-weather.js`, `electron/*` |
| `ui-electron-expert` | `src/ui/brain-ui/*`, `index.html`, `brain-ui.html`, `activation.html`, `dashboard.html`, `brain.html`, `systemPrompt.html`, `turn-trace.html`, `focus-banner.html`, `website.html` |
| `quality-gate` | All `src/test-*`, all `scripts/smoke-*`, `src/review/reviewer.js`, `src/prompt-blocks/coding-discipline.js`, build/release scripts, dependency audit, secret hygiene, `.gitignore`/`.gitattributes` |

To grow the team: use `mavis-team` to plan new roles, then `create-agent --target=project --project .` to add a rein under `.harness/reins/<name>/`.

## Where to find more

- Design philosophy + ACI rationale: `ACI-理念文档.md`
- Module split roadmap: `REFACTOR-MODULE-SPLIT-PLAN.md`
- Refactor safety constraints: `REFACTOR-SAFETY-PROMPT.md`
- Build / packaging gotchas: `BUILD-NOTES.md`
- Per-step change history: `CHANGES.md`, `CHANGES-STEP<n>.md`
- Release process: `RELEASE.md`
- Project memory (cross-rein): `.harness/memory/MEMORY.md` (write here only when something is true across all reins)
- Project code standards: `.harness/docs/code-standards.md`
- Project testing policy: `.harness/docs/testing-policy.md`