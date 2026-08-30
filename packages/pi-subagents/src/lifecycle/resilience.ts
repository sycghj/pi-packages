import {
  type AssistantMessage,
  isRetryableAssistantError,
  type Model,
} from "@earendil-works/pi-ai";
import type {
  AgentSession,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

/** Hard child-provider request cap: one upstream request may occupy at most ten minutes. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 10 * 60_000;
/** A successful assistant response resets this continuous provider-failure window. */
export const API_FAILURE_BUDGET_MS = 30 * 60_000;
/** Default wall-clock ceiling for one child run or resume. */
export const DEFAULT_MAX_RUNTIME_MS = 60 * 60_000;

const RETRY_CONTINUATION_PROMPT =
  "The previous model request failed before the task completed. Continue the original task from the existing conversation. Preserve completed work and return the final answer when done.";
const MAX_RETRY_DELAY_MS = 60_000;

/** Convert an optional positive minute override to the defaulted runtime ceiling. */
export function resolveMaxRuntimeMs(minutes: number | undefined): number {
  return minutes == null ? DEFAULT_MAX_RUNTIME_MS : Math.max(1, minutes) * 60_000;
}

/**
 * Apply child-only request/retry behavior to one SDK SettingsManager instance.
 * Method overrides stay in memory and never mutate the parent's settings files.
 */
export function configureChildResilience(
  settings: SettingsManager,
  ownsRetryLoop: boolean,
): SettingsManager {
  const readProviderRetry = settings.getProviderRetrySettings.bind(settings);
  settings.getProviderRetrySettings = () => {
    const inherited = readProviderRetry();
    return {
      ...inherited,
      timeoutMs: Math.min(inherited.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS, PROVIDER_REQUEST_TIMEOUT_MS),
    };
  };

  if (ownsRetryLoop) {
    const readAgentRetry = settings.getRetrySettings.bind(settings);
    settings.getRetrySettings = () => ({ ...readAgentRetry(), enabled: false });
    // AgentSession.setModel() normally persists a new global default. A fallback
    // is local to this child and must not alter the parent session's preference.
    settings.setDefaultModelAndProvider = () => {};
  }

  return settings;
}

export interface ResilientPromptOptions {
  fallbackModels: Model<any>[];
  maxRuntimeMs?: number;
  apiFailureBudgetMs?: number;
  signal?: AbortSignal;
  getPartialOutput: () => string;
}

/**
 * Drive one SDK prompt with wall-clock/failure watchdogs. Pi keeps its ordinary
 * retry loop when no fallback is configured. With fallbacks, this loop owns
 * retry so it can await model switches before continuing the same conversation.
 */
export async function driveResilientPrompt(
  session: AgentSession,
  initialPrompt: string,
  options: ResilientPromptOptions,
): Promise<void> {
  const monitor = new RunResilienceMonitor(
    session,
    options.getPartialOutput,
    options.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS,
    options.apiFailureBudgetMs ?? API_FAILURE_BUDGET_MS,
  );
  let prompt = initialPrompt;
  let retryAttempt = 0;
  let fallbackIndex = 0;

  try {
    for (;;) {
      await monitor.race(session.prompt(prompt));
      const message = getLastAssistantMessage(session);
      if (message?.stopReason !== "error") return;
      if (!isRetryableAssistantError(message)) {
        throw monitor.terminalError(message.errorMessage ?? "Model request failed.");
      }
      if (options.fallbackModels.length === 0) {
        throw monitor.terminalError("Provider retries exhausted.");
      }

      retryAttempt++;
      const delayMs = Math.min(2_000 * 2 ** (retryAttempt - 1), MAX_RETRY_DELAY_MS);
      await monitor.race(waitForRetry(delayMs, options.signal));

      if (fallbackIndex < options.fallbackModels.length) {
        await monitor.race(session.setModel(options.fallbackModels[fallbackIndex++]));
      }
      prompt = RETRY_CONTINUATION_PROMPT;
    }
  } finally {
    monitor.dispose();
  }
}

/** Tracks wall-clock and continuous provider-failure budgets for one prompt loop. */
class RunResilienceMonitor {
  private readonly timeout = Promise.withResolvers<never>();
  private readonly totalTimer: ReturnType<typeof setTimeout>;
  private failureTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly unsubscribe: () => void;
  private expired = false;
  private failureCount = 0;
  private lastError: string | undefined;

  constructor(
    private readonly session: AgentSession,
    private readonly getPartialOutput: () => string,
    maxRuntimeMs: number,
    apiFailureBudgetMs: number,
  ) {
    this.totalTimer = setTimeout(
      () => this.expire("Total runtime budget exceeded", maxRuntimeMs),
      maxRuntimeMs,
    );
    this.totalTimer.unref();

    this.unsubscribe = session.subscribe((event) => {
      if (event.type !== "message_end" || event.message.role !== "assistant") return;
      const message = event.message;
      if (message.stopReason === "error") {
        this.failureCount++;
        this.lastError = message.errorMessage ?? "Unknown provider error";
        if (!this.failureTimer) {
          this.failureTimer = setTimeout(
            () => this.expire("Continuous API failure budget exceeded", apiFailureBudgetMs),
            apiFailureBudgetMs,
          );
          this.failureTimer.unref();
        }
        return;
      }
      this.clearFailureTimer();
    });
  }

  race<T>(work: Promise<T>): Promise<T> {
    return Promise.race([work, this.timeout.promise]);
  }

  terminalError(prefix: string): Error {
    const details = [prefix, `API failures: ${this.failureCount}.`];
    if (this.lastError) details.push(`Last API error: ${this.lastError}.`);
    details.push(`Partial output: ${this.getPartialOutput().trim() || "none"}`);
    return new Error(details.join(" "));
  }

  dispose(): void {
    clearTimeout(this.totalTimer);
    this.clearFailureTimer();
    this.unsubscribe();
  }

  private clearFailureTimer(): void {
    if (this.failureTimer) clearTimeout(this.failureTimer);
    this.failureTimer = undefined;
  }

  private expire(reason: string, durationMs: number): void {
    if (this.expired) return;
    this.expired = true;
    this.timeout.reject(this.terminalError(`${reason} after ${(durationMs / 1000).toFixed(1)}s.`));
    void this.session.abort();
  }
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal ? abortReason(signal) : new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Aborted");
}

function getLastAssistantMessage(session: AgentSession): AssistantMessage | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (message.role === "assistant") return message;
  }
  return undefined;
}
