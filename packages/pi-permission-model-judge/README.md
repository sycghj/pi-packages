# @gotgenes/pi-permission-model-judge

A [Pi](https://github.com/earendil-works/pi) extension that reviews out-of-directory permission asks with a light model and auto-denies mistyped paths with a teaching reason.

It is the first consumer of [`@gotgenes/pi-permission-system`](../pi-permission-system/)'s `registerAuthorizer` seam: it registers a `"model-judge"` chain link that reviews `external_directory` asks, and — when a path matches one of your configured typo patterns — asks a model whether the path is a mistake.
A confirmed typo is denied with a short explanation (the wrong segment and the correct location) so the invoking agent self-corrects; everything else defers to the normal prompt.

## Why

Agents frequently invoke a tool against a malformed path — for example `…/pi-permission-system/packages/pi-permission-system/src/x.ts`, where the doubled segment should be `pi-packages`.
Each one lands as an `external_directory` ask you hand-deny, one by one.
This extension turns that repetitive hand-denial into an automatic, explained denial that teaches the agent the correct location.

## How it works

The reviewer runs a short, cheap decision on each ask and defers at the first miss:

1. The ask is on the `external_directory` surface (otherwise defer).
2. A candidate path is present (otherwise defer).
3. The path matches one of your `typoPatterns` (otherwise defer — no model call).
4. The model confirms the typo and returns a teaching reason (`deny`), or is unsure (`defer`).

The candidate path comes from a file tool's path argument (`read`/`edit`/`write`) or from an external path referenced inside a `bash` command — a typo path in `cat …/pi-permission-system/packages/pi-permission-system/README.md` is reviewed the same way as one passed to `read`.

It is fail-safe by construction: a missing model, invalid config, model timeout, unparseable reply, or an unsure verdict all resolve to `defer`.
Deferring means the ask falls through to the normal permission prompt — this extension only ever *removes* a hand-denial, never grants access (it emits no `allow`).

## What it records

Every review the link performs leaves a trail in pi-permission-system's shared review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`), so you can answer "did the judge run, did it reach the model, and why did it defer?"
without guesswork.

Once an ask matches a `typoPattern` — the case that *should* reach the model — the link writes one `model_judge.decision` entry recording the outcome:

| Field            | Meaning                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `requestId`      | Joins to the `permission_request.*` entries for the same ask.                                                                       |
| `path`           | The candidate path reviewed.                                                                                                        |
| `matchedPattern` | The `typoPatterns` entry (as you wrote it) that matched.                                                                            |
| `modelCalled`    | `false` when the model or its auth did not resolve.                                                                                 |
| `modelId`        | `<provider>/<model>`.                                                                                                               |
| `latencyMs`      | Model-call wall-clock in ms, or `null` when no call was made.                                                                       |
| `verdict`        | `"deny"` or `"defer"`.                                                                                                              |
| `deferReason`    | `null` on a deny, else one of `model-unresolved` / `auth-failed` / `no-tool-call` / `non-deny-verdict` / `timeout` / `call-failed`. |

Cheaper events go to pi-permission-system's **debug** log, and only when its `debugLog` toggle is on: `model_judge.short_circuit` (a `no-path` or `pattern-miss` defer) and `model_judge.model_reply` (the verdict tool-call arguments as JSON, or the model's text when it emitted no tool call).
A non-`external_directory` ask is not logged — it is not this link's concern.

Because every pattern-matched ask leaves a positive record, a misconfiguration that silently defers every path (an auth failure, an unresolved model) shows up as a run of `deferReason` entries rather than an empty log.

## Install

```bash
pnpm add -D @gotgenes/pi-permission-model-judge
```

This extension does nothing on its own — it requires `@gotgenes/pi-permission-system` (peer dependency) and `@earendil-works/pi-ai` (provided by Pi).

## Enable

Two independent config files are involved — the safety policy lives in pi-permission-system, the model mechanism lives here.

1. In your **pi-permission-system** config, name the link in `authorizerChain` (opt-in — the link decides nothing until you list it):

   ```jsonc
   // ~/.pi/agent/extensions/pi-permission-system/config.json
   { "authorizerChain": ["model-judge"] }
   ```

2. In **this** extension's config, declare the model mechanism and your typo patterns:

   ```jsonc
   // ~/.pi/agent/extensions/pi-permission-model-judge/config.json
   {
     "provider": "anthropic",
     "model": "claude-haiku-4-5",
     "instructions": "Deny a path that repeats a package name around `packages/`, or drops the repo's `pi-packages/packages/` prefix…",
     // Catches a doubled package segment and a dropped repository prefix.
     "typoPatterns": [
       "([^/]+)/packages/\\1(/|$)",
       "development/pi/(?!pi-packages/)pi-[^/]+(/|$)"
     ]
   }
   ```

See [`config/config.example.json`](config/config.example.json) for a complete example and [docs/configuration.md](docs/configuration.md) for the full field reference.

## Configuration

Config is layered — a project file (`<cwd>/.pi/extensions/pi-permission-model-judge/config.json`) overrides the global one — and validated against a [JSON Schema](schemas/model-judge.schema.json).

| Field          | Type       | Default  | Description                                                                                |
| -------------- | ---------- | -------- | ------------------------------------------------------------------------------------------ |
| `provider`     | `string`   | required | Model provider (e.g. `anthropic`), resolved against Pi's model registry.                   |
| `model`        | `string`   | required | Model id (e.g. `claude-haiku-4-5`).                                                        |
| `instructions` | `string`   | required | System prompt describing what a typo path is and the teaching reason to return.            |
| `typoPatterns` | `string[]` | `[]`     | Regular expressions; only a path matching one reaches the model. Empty means never review. |
| `timeoutMs`    | `integer`  | `5000`   | Per-review model-call budget in milliseconds; a timeout defers.                            |

An empty or absent `typoPatterns` (or a missing config) makes the reviewer defer everything — a safe no-op.

## License

MIT — see [LICENSE](LICENSE).
