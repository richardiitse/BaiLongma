# Testing Policy — Jarvis

> What to run, when to run it, and how to interpret failures.

## Smoke (fast, run on every PR)

```bash
npm run smoke:tools        # tool executor + per-domain schemas
npm run smoke:brain-ui     # Playwright on the dev server /brain-ui
npm run smoke:social       # Discord / WeChat bridge (Node CLI — known ABI limit; document if it fails)
```

Expected baseline: `smoke:tools` 6/6 passed, `smoke:brain-ui` passed. Add new smoke entries when you add a new tool or a new top-level route.

## Targeted tests (run when you touch the matching module)

```bash
npm run test:rule-context           # context rule engine
npm run test:complex-task           # multi-turn task routing
npm run test:relevance              # relevance selection
npm run test:section-gate           # section gate logic
npm run test:agent-skills           # agent skill registry
npm run test:config-upgrade         # config migration
node src/test-prompt-split.js       # prompt system/context split (32 assertions)
```

Many `src/test-*.js` files require Electron, not Node CLI. They live in the smoke list of the matching rein's `agent.md`.

## Known limitations

- **ABI mismatch**: Electron 33 builds `better-sqlite3` against ABI 130; Node 22 CLI uses ABI 127. Tests that need to write to SQLite will fail when run from Node CLI. Document this on the test rather than chasing the failure.
- **External network**: web_search / fetch_url tests can flake when the provider is unreachable. Use a minimal local unit check or document the flake threshold.
- **Media quota**: TTS / image / music generation consume real quotas. Prefer error/read-only smoke paths.

## When adding a new feature

1. Add a `src/test-<feature>.js` co-located with the feature module.
2. If the feature is a new tool, add an entry to `scripts/smoke-tools.mjs`.
3. If the feature is a new HTTP route, add a Playwright check to `scripts/smoke-brain-ui.mjs` or write a new `scripts/smoke-<route>.mjs`.
4. Update the relevant `src/test-*.js` if the existing test list overlaps.

## When the smoke breaks

1. Run the targeted test that maps to the failing smoke step.
2. Check whether the change introduced a schema-shape drift (tool JSON, HTTP JSON, DB schema, prompt block).
3. Revert the change if the regression is unintentional; otherwise fix forward and document in `CHANGES.md`.