# Auto Mode Ask-Branch Classifier Progress

## Current Status

`@gotgenes/pi-permission-system` now has a local fork implementation of ask-branch auto mode on branch `auto-mode-ask-classifier`.

The design keeps `pi-permission-system` as the sole policy authority:

- deterministic `deny` decisions block without calling the classifier;
- deterministic `allow` decisions pass without calling the classifier;
- only deterministic `ask` decisions can enter auto mode;
- `autoMode.enabled: false` preserves the normal UI prompt;
- `autoMode.enabled: true` lets the classifier resolve the pending `ask` decision;
- classifier output `<block>no</block>` auto-approves the request;
- classifier output `<block>yes</block>` denies the request;
- transient HTTP/network failures and malformed output retry before fallback;
- exhausted retries follow `fallback: "ask"` or `fallback: "deny"`.

This explicitly avoids a hardcoded safe-tool allowlist. Tool safety, path safety, sensitive path handling, shell aliases, and extension/MCP tool extraction remain owned by the permission system policy and extractor surfaces.

## Config Shape

`autoMode` is disabled by default:

```jsonc
{
  "autoMode": {
    "enabled": false,
    "provider": "new-provider",
    "modelId": "deepseek-v4-flash",
    "maxTokens": 256,
    "maxRetries": 2,
    "fallback": "ask"
  }
}
```

The global test config currently used on the local machine enables auto mode at:

```text
C:\Users\tzcbz\.pi\agent\extensions\pi-permission-system\config.json
```

## Implementation Notes

Key implementation files:

- `src/handlers/gates/auto-ask-decider.ts` defines the ask-branch decider contract.
- `src/handlers/gates/runner.ts` invokes the decider only for `check.state === "ask"` and falls back to the UI prompt on abstain/throw.
- `src/auto-mode-classifier.ts` implements Anthropic Messages-compatible classifier calls with bounded retry and fallback.
- `src/auto-mode-composition.ts` composes the decider from current config and runtime `ExtensionContext`.
- `src/index.ts` wires the real decider into `GateRunner`.
- `src/config-schema.ts`, `src/extension-config.ts`, and `schemas/permissions.schema.json` define and normalize `autoMode`.
- `src/config-loader.ts` now preserves/replaces `autoMode` during global/project config merge. This fixed the observed issue where the config file contained `enabled: true` but runtime still behaved as if auto mode were disabled.
- `README.md` documents ask-only semantics, default-disabled config, retry/fallback behavior, and the no-allowlist architecture.

## Verification

Focused Windows verification passed after the config merge fix:

```text
 RUN  v4.1.8 F:/code/pi/pi-packages/packages/pi-permission-system


 Test Files  5 passed (5)
      Tests  97 passed (97)
   Start at  12:27:58
   Duration  595ms (transform 636ms, setup 0ms, import 940ms, tests 56ms, environment 0ms)

$ tsc --noEmit
```

The focused verifier was used because the full package test suite has known unrelated Windows baseline failures around POSIX path expectations, home expansion, symlink/path flavor, and infrastructure-read path behavior.

## Local Install State

The local package path was installed globally into Pi:

```text
F:\code\pi\pi-packages\packages\pi-permission-system
```

Because the installed source is the local path, code edits in this working tree are picked up after restarting/reloading Pi. The latest merge fix still requires a Pi session reload/restart before manual testing.

## Suggested Manual Smoke Test

After restarting/reloading Pi, use:

```text
请运行一个只读的 shell 检查命令：pwd && git status --short。不要修改任何文件，不要安装依赖，不要访问网络，只展示命令输出。
```

Expected behavior:

- global policy maps `bash "*"` to `ask`;
- auto mode receives that `ask` decision;
- the classifier should auto-approve the harmless read-only command with `<block>no</block>`;
- no permission prompt should appear if the model call succeeds;
- if the model/auth/network/parser fails, `fallback: "ask"` returns to the normal UI prompt.

## Follow-Ups

- Restart Pi and rerun the manual smoke test.
- If a prompt still appears, enable `debugLog` and inspect `~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-debug.jsonl`.
- Add broader Linux/CI verification before proposing upstream PR.
- Build a golden classifier corpus before recommending auto mode for general use.
