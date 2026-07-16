import { describe, expect, it } from "vitest";
import { unifiedConfigSchema } from "#src/config-schema";

describe("unifiedConfigSchema autoMode", () => {
  it("accepts classifier runtime knobs", () => {
    const result = unifiedConfigSchema.safeParse({
      autoMode: {
        enabled: true,
        provider: "new-provider",
        modelId: "deepseek-v4-flash",
        maxTokens: 256,
        maxRetries: 2,
        fallback: "ask",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid classifier knobs", () => {
    expect(
      unifiedConfigSchema.safeParse({ autoMode: { maxTokens: 0 } }).success,
    ).toBe(false);
    expect(
      unifiedConfigSchema.safeParse({ autoMode: { provider: 42 } }).success,
    ).toBe(false);
    expect(
      unifiedConfigSchema.safeParse({ autoMode: { maxRetries: -1 } }).success,
    ).toBe(false);
    expect(
      unifiedConfigSchema.safeParse({ autoMode: { fallback: "allow" } })
        .success,
    ).toBe(false);
  });
});
