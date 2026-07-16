import { describe, expect, it } from "vitest";
import { normalizePermissionSystemConfig } from "#src/extension-config";

describe("normalizePermissionSystemConfig autoMode", () => {
  it("defaults to disabled fast classifier settings", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.autoMode).toEqual({
      enabled: false,
      provider: "new-provider",
      modelId: "deepseek-v4-flash",
      maxTokens: 256,
      maxRetries: 2,
      fallback: "ask",
    });
  });

  it("normalizes overrides", () => {
    const result = normalizePermissionSystemConfig({
      autoMode: {
        enabled: true,
        provider: "p",
        modelId: "m",
        maxTokens: 64,
        maxRetries: 4,
        fallback: "deny",
      },
    });
    expect(result.autoMode).toEqual({
      enabled: true,
      provider: "p",
      modelId: "m",
      maxTokens: 64,
      maxRetries: 4,
      fallback: "deny",
    });
  });
});
