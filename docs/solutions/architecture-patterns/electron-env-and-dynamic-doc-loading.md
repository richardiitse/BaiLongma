---
title: "Integrating sibling-project CLIs into a desktop agent — the five-layer pattern (env, path, docs, discovery, security)"
date: 2026-07-18
category: docs/solutions/electron
module: Electron main process + capability registry + xz CLI tool integration
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "Exposing a sibling-repo CLI (separate Swift/Node project) as a tool an agent can call from a packaged desktop app"
  - "An Electron main process needs configuration that lives in the repo .env"
  - "Tool descriptions keep drifting from an external CLI that adds subcommands independently"
  - "An agent must self-discover capabilities it does not see injected on every turn"
  - "A CLI executor that previously used execSync on a templated command string"
root_cause: incomplete_setup
resolution_type: code_fix
tags: [electron, env-file, spawn-no-shell, capability-registry, cli-integration, enoent, macos-launchd, shell-injection]
related_components:
  - electron/main.cjs
  - src/capabilities/capability-registry.js
  - src/capabilities/tools/xz-loader.js
  - src/capabilities/tools/xz.js
  - src/capabilities/schemas/xz.js
  - src/capabilities/tools/shell.js
  - src/prompt.js
---

# Integrating sibling-project CLIs into a desktop agent — the five-layer pattern

## Context

Jarvis (BaiLongma) is an Electron desktop agent. Two sibling projects — `xz-calendar` (Swift, `Package.swift`) and `xz-notes` (Node, `package.json`) — are maintained in separate repos alongside the agent and ship their own CLIs. The agent needs to call them as tools so the user can ask "show me today's appointments" or "compile this session note" and the agent routes to the right CLI.

After wiring up the tool schemas (`schemas/xz.js`) and executors (`tools/xz.js`), the integration was completely broken: the agent could neither discover the tools nor execute them. Every call either failed with `ENOENT` or silently no-op'd, and the agent had no idea the tools existed unless the user typed a keyword that happened to match. Investigation surfaced **five independent causes stacked on top of each other**, none of which was diagnosable from any single symptom — fixing one only unmasked the next.

| # | Symptom (what you see) | Root cause (what's actually wrong) |
|---|---|---|
| 1 | `.env` values missing from `process.env` in the running app | Electron ignores Node's `--env-file` flag |
| 2 | `spawn('xz-notes', ...)` throws `ENOENT` | macOS GUI apps inherit launchd's env, which has no `PATH` |
| 3 | Tool descriptions list subcommands that no longer exist | Descriptions were hardcoded in `schemas/xz.js` |
| 4 | Agent doesn't know the tools exist unless a keyword matches | Capabilities were injected per-turn by keyword; no catalog awareness |
| 5 | `execSync(\`"${bin}" ...\`)` is exploitable | Bin path was interpolated into a shell string |

The durable lesson is not any single fix — it is that **"expose a sibling CLI as an agent tool" is a five-layer stack, and each layer must be validated independently.** Treating it as one task produces an integration that looks wired up but fails at the first user turn.

## Guidance

Validate each layer separately. If any layer is missing, the symptom will look like a different layer is broken.

### Layer 1 — Load `.env` yourself; Electron will not

`--env-file=.env` is a Node.js runtime flag. Electron's main process is its own runtime and silently ignores it, so a `.env` placed in the repo root is never read by the packaged or `electron .` process. Load it by hand, at the **top of `electron/main.cjs`, before any module import that might read `process.env`**.

```js
// electron/main.cjs — must run before any require() that touches process.env
const path = require('path')
const fs = require('fs')
try {
  const envPath = path.join(__dirname, '..', '.env')
  const envText = fs.readFileSync(envPath, 'utf-8')
  for (const line of envText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val   // never override a real env var
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.error('[main] .env 加载失败:', e.message)
}
```

Two details matter: (a) **never overwrite an existing `process.env` key** — a real environment variable always wins over `.env`, so ops overrides keep working; (b) **only swallow `ENOENT`** — silently eating a syntax error turns "your `.env` is malformed" into "the integration just doesn't work," which is much harder to diagnose.

### Layer 2 — Resolve binaries by absolute path; never trust `PATH` in a GUI app

On macOS, a GUI app launched from Finder/Dock inherits `launchd`'s environment, which has **no `PATH`**. The user's shell `PATH` (set in `~/.zshrc` / `~/.bash_profile`) is never applied. `spawn('xz-notes', { shell:false })` with a bare binary name therefore fails with `ENOENT` even when `which xz-notes` works in a terminal.

Contract: an env var (`XZ_NOTES_CLI`, `XZ_CALENDAR_CLI`) holds the absolute path to the binary; the resolver falls back to the bare name only when the var is absent.

```js
// src/capabilities/tools/xz.js
function resolveXzNotesBin() {
  return process.env.XZ_NOTES_CLI || 'xz-notes'   // env-first; bare name only as last resort
}
```

Why env-var and not a config-file entry or a hardcoded path? A hardcoded maintainer path (a) ENOENTs on any other machine, and (b) leaks the maintainer's directory layout into shipped source. An env var is the same mechanism ops already uses for every other external dependency, and it composes with Layer 1 for free.

### Layer 3 — Generate tool descriptions at runtime from the source of truth

The CLI is a separate project that ships its own subcommands on its own cadence. A hardcoded description in the agent repo **will drift** the first time the sibling project adds a command — and the agent will confidently tell the model about subcommands that don't exist, or omit ones that do.

The loader reads the sibling project's own docs at runtime and falls back to a hardcoded summary only if loading fails. **Path discovery walks up from the absolute binary path** (from Layer 2's env var) until it finds the project marker — `Package.swift` for the Swift project, `package.json` for the Node one. This couples the agent to the project layout, not to a copy of its docs.

```js
// src/capabilities/tools/xz-loader.js
function findProjectRoot(binPath, marker) {
  let dir = path.dirname(binPath)
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, marker))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function getXzNotesDocs() {
  // lazy + cached: undefined=unloaded, null=failed, object=ok
  const bin = process.env.XZ_NOTES_CLI
  const root = findProjectRoot(bin, 'package.json')
  // ...read AGENTS.md, run `capabilities --json`, build description...
}

export function getXzCalendarDocs() {
  const root = findProjectRoot(process.env.XZ_CALENDAR_CLI, 'Package.swift')
  // ...read SKILL.md + cli-contract.md, extract subcommand summary...
}
```

Three rules that make this safe: (a) **lazy-init with a module-level cache** (`undefined` / `null` / object) so the runtime cost is paid once; (b) **return `null` on any failure** so the caller falls back to a hardcoded description instead of crashing the prompt build; (c) **the sibling project, not the agent, owns the docs** — `SKILL.md`, `cli-contract.md`, `AGENTS.md`, and `capabilities --json` are the sibling's contract surface; the agent only reads.

### Layer 4 — Let the agent see its own capability catalog

Tools are injected per-turn by keyword matching (a deliberate token-budget discipline). The side effect: the agent has **no awareness of capabilities that aren't keyword-matched this turn**, so it cannot say "I can also do X" or steer the user toward an unenabled feature.

Promote this from "invisible" to "self-aware" with two moves:

1. **A static capability registry** (`capability-registry.js`) — one entry per capability domain, declaring `{ id, label, summary, triggers, tools, detect, isEnabled, context }`. This is the single source of truth: `selectActiveCapabilities` (keyword match → context injection), `capabilityToolsFor` (keyword match → tool injection), `listCapabilities` (catalog export), and `findCapabilitiesByQuery` (runtime discovery) all read from the same array.

```js
// src/capabilities/capability-registry.js
{
  id: 'xz-tools',
  label: '心理咨询工具',
  summary: 'xz_calendar（来访者/预约/缴费）+ xz_notes（临床笔记/归档/安全）本机 CLI',
  triggers: XZ_TRIGGERS,
  tools: XZ_TOOLS,
  detect: (ctx) => isXzToolsEnabled() && XZ_KEYWORD_RE.test(ctx.rawText || ''),
  isEnabled: () => isXzToolsEnabled(),
  context: () => { /* lazy-load from xz-loader.js; fall back to hardcoded */ },
}
```

2. **Inject a one-line-per-capability manifest into the system prompt every turn.** The agent always knows the catalog exists, even when no tools for it are injected this turn; disabled capabilities are marked `（未启用）` so the agent can guide the user to settings.

```js
// src/prompt.js — hot path, must not throw
try {
  const caps = listCapabilities()
  if (caps.length > 0) {
    const lines = caps.map(c =>
      `- ${c.label} — ${c.summary}${c.enabled ? '' : '（未启用）'}`)
    prompt += `\n\n## 你的能力域\n...find_tool 按需加载...\n${lines.join('\n')}`
  }
} catch { /* catalog render failure must not break prompt build */ }
```

The `try/catch` is load-bearing: prompt construction is on the hot path of every turn, and a registry rendering bug must not take down the whole conversation.

### Layer 5 — Never `execSync` a templated command string; `spawn` with `shell:false`

The original executor interpolated the binary path into a command string and ran it through a shell:

```js
// VULNERABLE — bin path or args containing ; $() or backticks are executed
execSync(`"${bin}" ${args.join(' ')}`)
```

Replace with a dedicated no-shell executor that passes `bin` and `args` as a real argv array. Every arg becomes a literal token; `;`, `$()`, and backticks are bytes, not metacharacters.

```js
// src/capabilities/tools/shell.js
export async function execCommandNoShell({ bin, args = [], timeout, cwd } = {}, context = {}) {
  const argv = Array.isArray(args) ? args.map(String) : []
  const child = spawn(bin, argv, { cwd: execCwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  // ...timeout, abort, output trimming, exit-code handling...
}
```

Position subcommands as argv tokens, not as part of the command string — `buildArgv("appointment create", ["--json"])` splits the subcommand on whitespace and concatenates, so `spawn` receives `['appointment', 'create', '--json']` verbatim.

## Why This Matters

The cost of getting any single layer wrong is disproportionately large because the layers **mask each other**:

- **Without Layer 1, Layer 2 looks broken.** The env var with the absolute path is in `.env`; Electron never reads it; the resolver falls back to the bare name; macOS launchd has no PATH; you get `ENOENT`. The visible symptom points at the binary resolver, but the bug is in env loading. You can stare at `resolveXzNotesBin()` for an hour and miss it.
- **Without Layer 2, the integration works in `npm run dev` from a terminal and fails in the packaged app.** Dev shells have PATH; packaged GUI apps do not. This is the classic "works on my machine" trap for Electron.
- **Without Layer 3, the agent confidently hallucinates subcommands.** A stale hardcoded description is worse than no description — the model will call `xz_calendar foo` because the description told it `foo` exists, then retry with variations, burning the tool-call budget.
- **Without Layer 4, the user has to know the magic keyword.** Capabilities that aren't visible can't be steered toward; the agent can't proactively suggest them; toggling a feature in settings has no agent-side consequence until the right keyword appears.
- **Without Layer 5, a compromised or renamed binary path becomes arbitrary command execution.** For clinical tools handling sensitive patient data (appointments, session notes, consent records), shell injection is not theoretical.

The layered pattern also pays off in maintenance: when the sibling CLI adds a subcommand, **no agent-repo change is required** (Layer 3 reads it at runtime); when ops moves the binary, **no code change is required** (Layer 2 reads the new path from env); when a new capability domain is added, **one registry entry** wires it into injection, discovery, and the catalog simultaneously (Layer 4).

## When to Apply

Apply this pattern whenever **any** of these is true:

- You are exposing a CLI that lives in a different repo, package, or build pipeline as a tool an agent (or any in-process caller) can invoke.
- The host process is a packaged GUI app (Electron, Tauri, etc.) rather than a long-running server with a known shell environment.
- The CLI ships its own documentation (SKILL.md / AGENTS.md / `--help` / `capabilities --json`) that is more authoritative than anything you would copy into the host repo.
- The tool surface is large enough that keyword-based per-turn injection is used to control the prompt budget, and the agent needs catalog awareness of tools not injected this turn.
- The executor handles untrusted or semi-trusted input (file paths, free-text args) that could reach a shell.

If you are calling a CLI from a server with a known PATH and a single hardcoded invocation, Layers 1, 2, and 4 are unnecessary — a plain `execFile` is enough. The layers exist to handle the gaps that packaged-GUI-app + multi-project + agent-discovery introduces.

## Examples

### Before (broken end-to-end)

```js
// electron CLI invocation in main or a tool executor — all five layers broken
const { execSync } = require('child_process')

// Layer 1 broken: .env never loaded (Electron ignored --env-file)
// Layer 2 broken: bare name, no PATH in GUI process
// Layer 5 broken: shell interpolation
function runXzNotes(args) {
  return execSync(`xz-notes ${args.join(' ')}`)   // ENOENT in packaged app; injectable everywhere
}
```

```js
// schemas/xz.js — Layer 3 broken: hardcoded, drifts
export const XZ_NOTES_SCHEMA = {
  description: 'xz-notes CLI. Subcommands: note compile, note archive, note list.',
  // ... three months later, xz-notes adds `context appointment` and `doctor`;
  //     this description now lies to the model.
}
```

```js
// no capability registry — Layer 4 broken: agent blind unless keyword matches
// user: "pull up my 3pm" — no keyword hit — agent: "I can't do that"
```

### After (five-layer integration)

```js
// electron/main.cjs (top of file) — Layer 1
loadDotEnvManually(path.join(__dirname, '..', '.env'))   // reads .env, never overrides real env

// src/capabilities/tools/xz.js — Layers 2 + 5
function resolveXzNotesBin() { return process.env.XZ_NOTES_CLI || 'xz-notes' }
export async function execXzNotes({ command, args } = {}) {
  if (!isXzToolsEnabled()) return disabled('xz_notes')
  return await execCommandNoShell({                  // shell:false, argv array
    bin: resolveXzNotesBin(),
    args: buildArgv(command, args),                  // "note compile" → ['note','compile']
  }, context)
}

// src/capabilities/tools/xz-loader.js — Layer 3
export function getXzNotesDocs() {
  const root = findProjectRoot(process.env.XZ_NOTES_CLI, 'package.json')
  // read AGENTS.md + run `capabilities --json` → build description + context block
  // return null on any failure → caller falls back to hardcoded
}

// src/capabilities/schemas/xz.js — Layer 3 consumer
function notesDesc() {
  return getXzNotesDocs()?.description || FALLBACK_NOTES_DESC   // dynamic, with safety net
}

// src/capabilities/capability-registry.js — Layer 4
{
  id: 'xz-tools',
  tools: ['xz_calendar', 'xz_notes'],
  detect: (ctx) => isXzToolsEnabled() && XZ_KEYWORD_RE.test(ctx.rawText || ''),
  context: () => /* lazy-load from xz-loader */,
}

// src/prompt.js — Layer 4 manifest (every turn)
prompt += `\n## 你的能力域\n${listCapabilities().map(c => `- ${c.label} — ${c.summary}`).join('\n')}`
```

The git history reflects the order in which the layers were actually unmasked during the session that produced this doc: `805bc5d feat(capability): agent 能力自感知 + xz 迁移 registry + .env 加载器` (Layers 1 + 4), then `6f044f3 feat(xz): 动态加载 xz 项目文档作为工具描述` (Layer 3), then the security pass `add66a9 fix(security): ... run_cli 防 shell 注入` (Layer 5). Layer 2 was folded in across the same sequence. The fact that no single commit fixed the integration is the point — the layers are discovered by peeling symptoms, not by planning.

## Related

- Commit chain: `174c117 → 805bc5d → 6f044f3 → 3fc9240 → 2b17a95 → 94ffaa2 → 31d03c4 → cc8467e → 5234f38 → 21da53f` (xz integration, end-to-end dogfood-verified)
- `electron/main.cjs` lines 18-44 — Layer 1 `.env` loader
- `src/capabilities/tools/xz.js` — Layers 2 + 5 (`resolveXz*Bin`, `execCommandNoShell` consumer, read-command allowlist for irreversible-action confirmation)
- `src/capabilities/tools/xz-loader.js` — Layer 3 dynamic doc loader
- `src/capabilities/schemas/xz.js` — Layer 3 schema consumer with hardcoded fallbacks
- `src/capabilities/capability-registry.js` — Layer 4 single-source-of-truth registry
- `src/prompt.js` (capability manifest injection, ~line 635) — Layer 4 catalog in system prompt
- `src/capabilities/tools/shell.js` `execCommandNoShell` — Layer 5 no-shell executor (reusable beyond xz)
