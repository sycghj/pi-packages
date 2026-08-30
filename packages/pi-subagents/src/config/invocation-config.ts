import type { AgentConfig, ThinkingLevel } from "#src/types";

interface AgentInvocationParams {
  model?: string;
  thinking?: string;
  max_turns?: number;
  max_runtime_minutes?: number;
  run_in_background?: boolean;
  inherit_context?: boolean;
}

export function resolveAgentInvocationConfig(
  agentConfig: AgentConfig | undefined,
  params: AgentInvocationParams,
): {
  modelInput?: string;
  modelFromParams: boolean;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  maxRuntimeMinutes?: number;
  inheritContext: boolean;
  runInBackground: boolean;
} {
  return {
    modelInput: agentConfig?.model ?? params.model,
    modelFromParams: agentConfig?.model == null && params.model != null,
    thinking: (agentConfig?.thinking ?? params.thinking) as ThinkingLevel | undefined,
    maxTurns: agentConfig?.maxTurns ?? params.max_turns,
    maxRuntimeMinutes: agentConfig?.maxRuntimeMinutes ?? params.max_runtime_minutes,
    inheritContext: agentConfig?.inheritContext ?? params.inherit_context ?? false,
    runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? false,
  };
}
