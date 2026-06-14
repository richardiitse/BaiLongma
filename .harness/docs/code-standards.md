# Code Standards — Jarvis

> Project-wide rules. Each rein's `agent.md` links here instead of inlining rules.

## Language and modules

- Plain JavaScript (ESM, `"type": "module"` in `package.json`). Do not introduce TypeScript.
- No new server frameworks (Express, Koa, etc.). The current local server is hand-rolled in `src/api.js`.
- Module path style: relative imports within `src/`; no path aliases.

## Naming

- Files: `kebab-case.js` (e.g. `focus-classifier.js`, `tool-protocol.js`).
- Tool names: `snake_case` (e.g. `web_search`, `schedule_reminder`). These are wire-level contracts — **do not rename**.
- Public function exports: `camelCase`.
- Class names: `PascalCase`.

## File size and module split

- Soft cap: **800 lines per file**. Above that, split per `REFACTOR-MODULE-SPLIT-PLAN.md`.
- Always preserve public exports when splitting. Re-export back-compat shims from the original module path.
- One responsibility per file. If a file has both "schema definition" and "execution", split into `schemas/<x>.js` + `tools/<x>.js`.

## Tests

- Test files: `src/test-<topic>.js` (or `.mjs`) co-located with the module they exercise.
- Smoke scripts: `scripts/smoke-<topic>.mjs` for cross-cutting integration checks.
- Use `node --check` as the minimum gate before commit.
- Test framework: vanilla Node — no Jest/Mocha. Match existing assertion style.

## Refactor discipline

- **Structural changes only**, no behavior changes (per `REFACTOR-MODULE-SPLIT-PLAN.md`).
- One clear boundary per commit. Run the matching smoke after each split.
- If a refactor would force a behavior change, **stop and explain** — do not silently break public contracts.

## Config and secrets

- `config.json` stores non-secret defaults + provider metadata.
- API keys come from `.env` first (loaded by `node --env-file=.env`), then `config.json` user overrides, then user input via the activation page.
- Never log API keys. Never write a real key into a committed file.
- The plaintext Volcengine API key in the current `config.json` is a **known defect** — track remediation as a dedicated ticket, don't fix it inside unrelated work.

## Documentation

- `CHANGES.md` for behavioral changes (per-step).
- `CHANGES-STEP<n>.md` for older per-step records (already in the tree).
- `REFACTOR-MODULE-SPLIT-PLAN.md` for the multi-step split roadmap.
- `BUILD-NOTES.md` for packaging gotchas.
- `ACI-理念文档.md` for the design philosophy (preemptive injection, ambient autonomy, focus stack).

## Git hygiene

- Conventional commit messages (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).
- One concern per commit. Don't mix refactor + behavior in the same commit.
- `data/` and `sandbox/` are runtime state — never commit.
- `.harness/` is committed (this is the team definition).