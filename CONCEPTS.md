# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Assistant Reply Delivery

The subsystem that turns an inbound user message into an outbound assistant reply and routes it to the right channel.

### Turn Engine

One of two runtime-selected engines that produces an assistant reply for a turn. The active engine is chosen per-turn by a config flag: the default engine runs the model in-process, the alternative (Pi) engine runs the model in a forked system-node worker because its SDK cannot run inside Electron's node. Both expose the same callback surface (streaming, tool execution) and both must return reply content stripped of protocol markers before it reaches any downstream surface — sanitization is a per-engine obligation at every return path, not a guarantee provided by the caller.

### Protocol Markers

A text protocol the model embeds in its raw reply to signal runtime side-effects — setting a task, requesting memory recall, updating its persona, or expressing a mood. Markers are parsed for their side-effect, then stripped from any text that reaches a user-visible surface, so users never see them. The five markers are set-task, clear-task, recall, update-persona, and mood. A single source of truth owns both parsing and stripping; any reply return path that bypasses it leaks markers into downstream events.
