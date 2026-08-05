import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type {
  PermissionsService,
  PromptPermissionDetails,
} from "@gotgenes/pi-permission-system";
import {
  publishPermissionsService,
  unpublishPermissionsService,
} from "@gotgenes/pi-permission-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadConfigResult } from "#src/config-loader";
import { createModelJudgeExtension } from "#src/extension";
import type { CompleteFn } from "#src/model-review";
import { assistantToolCall } from "#test/fixtures/assistant-message";

const READY_CHANNEL = "permissions:ready";

const CONFIG_RESULT: LoadConfigResult = {
  config: {
    provider: "anthropic",
    model: "claude-haiku",
    instructions: "Flag doubled path segments.",
    typoPatterns: [
      "packages/pi-permission-system/packages/pi-permission-system",
    ],
    timeoutMs: 5000,
  },
  issues: [],
};

const MODEL = { provider: "anthropic", id: "claude-haiku" } as Model<any>;

interface FakePi {
  lifecycle: Map<string, (event: unknown, ctx: unknown) => void>;
  events: Map<string, (data: unknown) => void>;
  api: {
    on: ReturnType<typeof vi.fn>;
    events: { on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
  };
}

function makeFakePi(): FakePi {
  const lifecycle = new Map<string, (event: unknown, ctx: unknown) => void>();
  const events = new Map<string, (data: unknown) => void>();
  return {
    lifecycle,
    events,
    api: {
      on: vi.fn(
        (name: string, handler: (event: unknown, ctx: unknown) => void) => {
          lifecycle.set(name, handler);
        },
      ),
      events: {
        on: vi.fn((channel: string, handler: (data: unknown) => void) => {
          events.set(channel, handler);
          return () => events.delete(channel);
        }),
        emit: vi.fn(),
      },
    },
  };
}

function makeService(): PermissionsService & {
  registerAuthorizer: ReturnType<typeof vi.fn>;
  disposer: ReturnType<typeof vi.fn>;
} {
  const disposer = vi.fn();
  return {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
    registerToolInputFormatter: vi.fn(() => () => {}),
    registerToolAccessExtractor: vi.fn(() => () => {}),
    registerAuthorizer: vi.fn(() => disposer),
    disposer,
  };
}

function ctxWithRegistry(): {
  cwd: string;
  modelRegistry: {
    find: () => Model<any>;
    getApiKeyAndHeaders: () => Promise<{ ok: true; apiKey: string }>;
  };
} {
  return {
    cwd: "/project",
    modelRegistry: {
      find: () => MODEL,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "sk-test" }),
    },
  };
}

let service: ReturnType<typeof makeService>;

beforeEach(() => {
  service = makeService();
});

afterEach(() => {
  unpublishPermissionsService(service);
  vi.restoreAllMocks();
});

describe("createModelJudgeExtension", () => {
  it("registers the model-judge link when config loads before the service is ready", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });

    // session_start fires first (config captured), then the service publishes
    // and emits ready.
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    publishPermissionsService(service);
    pi.events.get(READY_CHANNEL)?.({});

    expect(service.registerAuthorizer).toHaveBeenCalledTimes(1);
    expect(service.registerAuthorizer.mock.calls[0]?.[0]).toBe("model-judge");
  });

  it("registers when the service is ready before this session_start (pps-first order)", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });

    // pps published and emitted ready before this extension's session_start ran.
    publishPermissionsService(service);
    pi.events.get(READY_CHANNEL)?.({});
    expect(service.registerAuthorizer).not.toHaveBeenCalled();

    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    expect(service.registerAuthorizer).toHaveBeenCalledTimes(1);
  });

  it("registers only once across both triggers", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    publishPermissionsService(service);
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    pi.events.get(READY_CHANNEL)?.({});
    pi.events.get(READY_CHANNEL)?.({});
    expect(service.registerAuthorizer).toHaveBeenCalledTimes(1);
  });

  it("registers nothing when config is absent", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => ({ config: undefined, issues: [] }),
      complete: vi.fn(),
    });
    publishPermissionsService(service);
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    pi.events.get(READY_CHANNEL)?.({});
    expect(service.registerAuthorizer).not.toHaveBeenCalled();
  });

  it("registers nothing when no service is published", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    pi.events.get(READY_CHANNEL)?.({});
    expect(service.registerAuthorizer).not.toHaveBeenCalled();
  });

  it("disposes the registration on session_shutdown", () => {
    const pi = makeFakePi();
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete: vi.fn(),
    });
    publishPermissionsService(service);
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    pi.events.get(READY_CHANNEL)?.({});

    pi.lifecycle.get("session_shutdown")?.({}, ctxWithRegistry());
    expect(service.disposer).toHaveBeenCalledTimes(1);
  });

  it("registers an authorize callback that denies a matched typo path", async () => {
    const pi = makeFakePi();
    const complete: CompleteFn = vi.fn(async () => denyReply());
    createModelJudgeExtension(pi.api as never, {
      loadConfig: () => CONFIG_RESULT,
      complete,
    });
    publishPermissionsService(service);
    pi.lifecycle.get("session_start")?.({}, ctxWithRegistry());
    pi.events.get(READY_CHANNEL)?.({});

    const authorize = service.registerAuthorizer.mock.calls[0]?.[1] as (
      details: PromptPermissionDetails,
      query: unknown,
      log: { review: () => void; debug: () => void },
    ) => Promise<unknown>;
    const verdict = await authorize(
      {
        requestId: "r1",
        source: "tool_call",
        agentName: null,
        message: "external directory",
        surface: "external_directory",
        path: "/x/packages/pi-permission-system/packages/pi-permission-system/a.ts",
      },
      {},
      { review: vi.fn(), debug: vi.fn() },
    );
    expect(verdict).toEqual({
      kind: "deny",
      reason: "Doubled; use pi-packages.",
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

function denyReply(): AssistantMessage {
  return assistantToolCall({
    verdict: "deny",
    reason: "Doubled; use pi-packages.",
  });
}
