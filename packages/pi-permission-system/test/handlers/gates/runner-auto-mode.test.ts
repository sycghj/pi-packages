import { describe, expect, it, vi } from "vitest";
import { makeDescriptor, makeGateRunner } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

describe("GateRunner auto ask decider", () => {
  it("auto-approves ask decisions without prompting when decider allows", async () => {
    const autoDecide = vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      autoApproved: true,
    });
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
    });

    const result = await runner.run(makeDescriptor(), null, "tc-1");

    expect(result).toEqual({ action: "allow" });
    expect(autoDecide).toHaveBeenCalledOnce();
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ result: "allow", resolution: "auto_approved" }),
    );
  });

  it("auto-denies ask decisions without prompting when decider denies", async () => {
    const autoDecide = vi.fn().mockResolvedValue({
      approved: false,
      state: "denied_with_reason",
      denialReason: "classifier blocked",
    });
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
    });

    const result = await runner.run(makeDescriptor(), null, "tc-1");

    expect(result).toMatchObject({ action: "block" });
    expect(autoDecide).toHaveBeenCalledOnce();
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ result: "deny", resolution: "user_denied" }),
    );
  });

  it("falls back to the user prompt when decider abstains", async () => {
    const autoDecide = vi.fn().mockResolvedValue(null);
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      autoDecide,
      escalate: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
    });

    const result = await runner.run(makeDescriptor(), null, "tc-1");

    expect(result).toEqual({ action: "allow" });
    expect(autoDecide).toHaveBeenCalledOnce();
    expect(deps.escalate).toHaveBeenCalledOnce();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ result: "allow", resolution: "user_approved" }),
    );
  });

  it("does not call the decider for policy allow or deny", async () => {
    const autoDecide = vi.fn().mockResolvedValue(null);
    const allowRunner = makeGateRunner({ autoDecide });
    const denyRunner = makeGateRunner({
      autoDecide,
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });

    await allowRunner.runner.run(makeDescriptor(), null, "tc-1");
    await denyRunner.runner.run(makeDescriptor(), null, "tc-2");

    expect(autoDecide).not.toHaveBeenCalled();
  });
});
