/**
 * Extension wiring: load the config at `session_start`, register the
 * `"model-judge"` link once the permission service is ready, and dispose on
 * shutdown.
 *
 * Registration is attempted from both `session_start` and `permissions:ready`
 * behind an idempotency guard, because the two orderings are both possible: the
 * ready event fires inside pi-permission-system's own `session_start`, which may
 * run before or after this extension's. Whichever completes the pair
 * (config loaded here + service published there) triggers the single
 * registration; the guard prevents a duplicate (which `registerAuthorizer`
 * would reject).
 */

import { complete as realComplete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getPermissionsService,
  PERMISSIONS_READY_CHANNEL,
} from "@gotgenes/pi-permission-system";

import { type LoadConfigResult, loadModelJudgeConfig } from "./config-loader";
import {
  MODEL_JUDGE_EXTENSION_ID,
  type ModelJudgeConfig,
} from "./config-schema";
import type { CompleteFn, ModelRegistryLike } from "./model-review";
import { createTypoReviewer } from "./typo-reviewer";

/** The operator-facing chain-link name referenced from `authorizerChain`. */
const LINK_NAME = "model-judge";

/** Injectable seams; production defaults read the filesystem and call the model. */
export interface ModelJudgeDependencies {
  loadConfig?: (cwd: string) => LoadConfigResult;
  complete?: CompleteFn;
}

function warn(message: string): void {
  console.warn(`[${MODEL_JUDGE_EXTENSION_ID}] ${message}`);
}

export function createModelJudgeExtension(
  pi: ExtensionAPI,
  dependencies: ModelJudgeDependencies = {},
): void {
  const loadConfig =
    dependencies.loadConfig ?? ((cwd: string) => loadModelJudgeConfig({ cwd }));
  const complete: CompleteFn =
    dependencies.complete ??
    ((model, context, options) => realComplete(model, context, options));

  let sessionStarted = false;
  let config: ModelJudgeConfig | undefined;
  let registry: ModelRegistryLike | undefined;
  let dispose: (() => void) | undefined;

  function tryRegister(): void {
    if (dispose || !sessionStarted || !config) {
      return;
    }
    const service = getPermissionsService();
    if (!service) {
      return;
    }
    const authorize = createTypoReviewer({
      getConfig: () => config,
      getRegistry: () => registry,
      complete,
    });
    dispose = service.registerAuthorizer(LINK_NAME, authorize);
  }

  pi.on("session_start", (_event, ctx) => {
    const result = loadConfig(ctx.cwd);
    config = result.config;
    registry = ctx.modelRegistry;
    sessionStarted = true;
    for (const issue of result.issues) {
      warn(
        `config issue at ${issue.sourcePath ?? "(merged)"} — ${issue.path}: ${issue.message}`,
      );
    }
    tryRegister();
  });

  pi.events.on(PERMISSIONS_READY_CHANNEL, () => {
    tryRegister();
  });

  pi.on("session_shutdown", () => {
    dispose?.();
    dispose = undefined;
    sessionStarted = false;
    config = undefined;
    registry = undefined;
  });
}
