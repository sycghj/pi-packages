import "./auto-mode-composition.test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ClassifierAutoAskDecider } from "#src/auto-mode-classifier";
import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

const request: AutoAskDecisionRequest = {
  agentName: null,
  check: makeCheckResult({ state: "ask" }),
  input: { command: "git status" },
  prompt: {
    source: "tool_call",
    agentName: null,
    message: "Allow tool 'bash'?",
    toolCallId: "tc-1",
    toolName: "bash",
  },
  toolCallId: "tc-1",
};

function config(overrides = {}) {
  return {
    enabled: true,
    provider: "new-provider",
    modelId: "deepseek-v4-flash",
    maxTokens: 256,
    maxRetries: 2,
    fallback: "ask" as const,
    ...overrides,
  };
}

function response(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status });
}

function makeContext(options: { authOk?: boolean; model?: boolean } = {}) {
  const model = { id: "deepseek-v4-flash", baseUrl: "https://api.example.test" };
  const authOk = options.authOk ?? true;
  return {
    modelRegistry: {
      find: vi.fn(() => (options.model === false ? undefined : model)),
      getApiKeyAndHeaders: vi.fn(async () =>
        authOk ? { ok: true, apiKey: "key" } : { ok: false },
      ),
    },
  } as unknown as ExtensionContext;
}

describe("ClassifierAutoAskDecider", () => {
  it("abstains without calling the model when disabled", async () => {
    const post = vi.fn(async () => response("<block>no</block>"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ enabled: false, provider: "p", modelId: "m" }),
      makeContext,
      post,
    );

    await expect(decider.decide(request)).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("auto-approves block-no responses", async () => {
    const post = vi.fn(async () => response("<block>no</block>"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ maxTokens: 64 }),
      makeContext,
      post,
    );

    await expect(decider.decide(request)).resolves.toEqual({
      approved: true,
      state: "approved",
      autoApproved: true,
    });
    const calls = post.mock.calls as unknown as Array<[string, RequestInit]>;
    const init = calls[0]?.[1];
    expect(calls[0]?.[0]).toBe("https://api.example.test/v1/messages");
    expect(init).toBeDefined();
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "deepseek-v4-flash",
      max_tokens: 64,
      stop_sequences: ["</block>"],
    });
  });

  it("auto-denies block-yes responses with reason", async () => {
    const post = vi.fn(async () => response("<block>yes</block><reason>danger</reason>"));
    const decider = new ClassifierAutoAskDecider(
      () => config(),
      makeContext,
      post,
    );

    await expect(decider.decide(request)).resolves.toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "danger",
    });
  });

  it("retries transient HTTP failure before deciding", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(response("bad", 500))
      .mockResolvedValueOnce(response("<block>no</block>"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ maxRetries: 1 }),
      makeContext,
      post,
    );

    await expect(decider.decide(request)).resolves.toEqual({
      approved: true,
      state: "approved",
      autoApproved: true,
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retries malformed classifier output before deciding", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(response("maybe"))
      .mockResolvedValueOnce(response("<block>yes</block><reason>unsafe</reason>"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ maxRetries: 1 }),
      makeContext,
      post,
    );

    await expect(decider.decide(request)).resolves.toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "unsafe",
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("falls back to ask when retry attempts are exhausted", async () => {
    const post = vi.fn(async () => response("maybe"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ maxRetries: 1, fallback: "ask" as const }),
      makeContext,
      post,
    );

    await expect(decider.decide(request)).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("falls back to deny when configured", async () => {
    const post = vi.fn(async () => response("maybe"));
    const decider = new ClassifierAutoAskDecider(
      () => config({ maxRetries: 1, fallback: "deny" as const }),
      makeContext,
      post,
    );

    await expect(decider.decide(request)).resolves.toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "Auto mode classifier failed closed.",
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("does not retry model or auth setup failures", async () => {
    const post = vi.fn(async () => response("<block>no</block>"));
    const missingModel = new ClassifierAutoAskDecider(
      () => config({ fallback: "deny" as const }),
      () => makeContext({ model: false }),
      post,
    );
    const missingAuth = new ClassifierAutoAskDecider(
      () => config({ fallback: "deny" as const }),
      () => makeContext({ authOk: false }),
      post,
    );

    await expect(missingModel.decide(request)).resolves.toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "Auto mode classifier failed closed.",
    });
    await expect(missingAuth.decide(request)).resolves.toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "Auto mode classifier failed closed.",
    });
    expect(post).not.toHaveBeenCalled();
  });
});
