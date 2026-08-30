---
status: accepted
date: 2026-08-05
---

# 0005 — Bound provider failures and allow explicit model fallback

## Status

Accepted.

## Context

A child session can inherit provider settings that are appropriate for an interactive parent but unsafe for autonomous work.
A real failure through CCH → AxonHub → OpenCode Go left `deepseek-v4-flash-0731` requests queued for 4–7 minutes before the first token, with some requests returning 499/503 only after 10–15 minutes.
The child inherited a 30-minute provider timeout and repeatedly retried the same upstream, so one read-only exploration occupied a subagent for about 67 minutes without reaching a final report.

Pi already classifies transient provider errors and retries them.
The missing boundaries are specific to autonomous child execution:

- one provider request must not occupy the child indefinitely;
- a sequence of failed requests needs a continuous failure budget that a successful response resets;
- the complete run needs a wall-clock ceiling;
- an agent definition needs an explicit ordered fallback list when multiple usable models exist;
- a child model switch must not rewrite the parent's persisted default model.

`AgentSession.prompt()` spans the whole agent/tool loop, so placing the request timeout around that method would also kill healthy long-running tasks.
The provider request cap therefore belongs on the child session's SDK settings instance, while the larger failure and runtime budgets belong around the child prompt loop.

## Decision

The lifecycle core owns bounded execution because spawning, running, aborting, and collecting a child are already core responsibilities.
No provider-specific names or routing rules are hardcoded.

1. Every child `SettingsManager` caps `retry.provider.timeoutMs` at 10 minutes in memory.
   A shorter inherited timeout remains shorter; retry counts and delay caps are otherwise preserved.
2. A run or resume has a 60-minute wall-clock ceiling.
   The `max_runtime_minutes` tool/frontmatter field can override it per task or agent definition.
3. Assistant messages with `stopReason: "error"` start a 30-minute continuous API-failure window.
   Any non-error assistant response clears that window; the cumulative failure count remains available for diagnostics.
4. `fallback_models` is an ordered, comma-separated custom-agent frontmatter field.
   Models are resolved through the existing available-model registry at spawn time.
5. Without fallbacks, Pi retains ownership of its built-in retry loop.
   With fallbacks, the child disables that inner loop, waits with 2-second exponential backoff capped at 60 seconds, awaits `AgentSession.setModel()` for the next candidate, and re-prompts the existing conversation to continue rather than starting a fresh child.
   After all candidates are used, retries remain on the last fallback until a budget expires or a response succeeds.
6. The child settings instance replaces `setDefaultModelAndProvider()` with an in-memory no-op whenever fallback is enabled.
   Session transcript model-change entries still record the switch, but the parent's global default is unchanged.
7. Budget failures abort the session and report the cumulative API failure count, last API error, and latest partial output.

## Consequences

- A slow provider can occupy one request for at most 10 minutes and one child run for at most 60 minutes by default.
- Brief outages still recover through Pi's normal retry path, or through the fallback loop when configured.
- Fallback is opt-in and provider-neutral; an agent without `fallback_models` behaves as before except for the child request cap and wall-clock budgets.
- The same child transcript and tool progress survive a fallback switch.
- `SubagentSession` remains the born-complete session wrapper; retry policy and watchdog state live in the focused lifecycle module `resilience.ts`.
- The public `SpawnOptions` surface gains `maxRuntimeMinutes`, so its declaration bundle and throwaway-consumer verification must pass before release.
