/**
 * spawn-config.ts — Pure config resolution for the Agent tool.
 *
 * Extracts all config resolution logic from execute: type resolution,
 * invocation config merge, model resolution, max-turns normalization,
 * tag building, and detail-base construction.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentTypeRegistry } from "#src/config/agent-types";
import { resolveAgentInvocationConfig } from "#src/config/invocation-config";
import { normalizeMaxTurns } from "#src/lifecycle/turn-limits";
import type { ModelRegistry } from "#src/session/model-resolver";
import { resolveInvocationModel, resolveModel } from "#src/session/model-resolver";
import type { AgentInvocation, SubagentType, ThinkingLevel } from "#src/types";
import {
  type AgentDetails,
  buildInvocationTags,
  getDisplayName,
  getPromptModeLabel,
} from "#src/ui/display";

/** Model info extracted from the parent session context. */
export interface ModelInfo {
  parentModel: Model<any> | undefined;
  modelRegistry: ModelRegistry | undefined;
}

/** Identity: who is being spawned. */
export interface SpawnIdentity {
  subagentType: string;
  rawType: SubagentType;
  fellBack: boolean;
  displayName: string;
}

/** Execution: how the agent will run. */
export interface SpawnExecution {
  prompt: string;
  description: string;
  model: Model<any> | undefined;
  fallbackModels: Model<any>[];
  effectiveMaxTurns: number | undefined;
  maxRuntimeMinutes: number | undefined;
  thinking: ThinkingLevel | undefined;
  inheritContext: boolean;
  runInBackground: boolean;
  agentInvocation: AgentInvocation;
}

/** Presentation: display/UI values derived from identity and execution. */
export interface SpawnPresentation {
  modelName: string | undefined;
  agentTags: string[];
  detailBase: Pick<AgentDetails, "displayName" | "description" | "subagentType" | "modelName" | "tags">;
}

/** Fully resolved config for spawning an agent — composed of domain-aligned sub-interfaces. */
export interface ResolvedSpawnConfig {
  identity: SpawnIdentity;
  execution: SpawnExecution;
  presentation: SpawnPresentation;
}

/** Error result when model resolution fails. */
export interface SpawnConfigError {
  error: string;
}

/**
 * Resolve all config for an Agent tool invocation.
 *
 * Pure function — no SDK types, no side effects.
 * Returns either a fully resolved config or an error.
 */
export function resolveSpawnConfig(
  params: Record<string, unknown>,
  registry: AgentTypeRegistry,
  modelInfo: ModelInfo,
  settings: { readonly defaultMaxTurns: number | undefined },
): ResolvedSpawnConfig | SpawnConfigError {
  const rawType = params.subagent_type as SubagentType;
  const resolved = registry.resolveType(rawType);

  // A known-but-disabled type is an explicit error, not a silent unknown-type fallback.
  if (resolved !== undefined && !registry.isValidType(resolved)) {
    return { error: `Agent type "${resolved}" is disabled` };
  }

  const subagentType = resolved ?? "general-purpose";
  const fellBack = resolved === undefined;

  const displayName = getDisplayName(subagentType, registry);

  // Merge agent config defaults with tool-call params
  const customConfig = registry.resolveAgentConfig(subagentType);
  const resolvedConfig = resolveAgentInvocationConfig(customConfig, params);

  // Resolve model
  const resolution = resolveInvocationModel(
    modelInfo.parentModel,
    resolvedConfig.modelInput,
    resolvedConfig.modelFromParams,
    modelInfo.modelRegistry,
  );
  if (resolution.error) return { error: resolution.error };
  const model = resolution.model;

  const fallbackResolution = resolveFallbackModels(
    customConfig.fallbackModels,
    modelInfo.modelRegistry,
    model,
  );
  if (typeof fallbackResolution === "string") return { error: fallbackResolution };
  const fallbackModels = fallbackResolution;

  const thinking = resolvedConfig.thinking;
  const inheritContext = resolvedConfig.inheritContext;
  const runInBackground = resolvedConfig.runInBackground;

  // Compute display model name (only shown when different from parent)
  const parentModelId = modelInfo.parentModel?.id;
  const effectiveModelId = model?.id;
  const modelName =
    effectiveModelId && effectiveModelId !== parentModelId
      ? model.name.replace(/^Claude\s+/i, "").toLowerCase()
      : undefined;

  const effectiveMaxTurns = normalizeMaxTurns(
    resolvedConfig.maxTurns ?? settings.defaultMaxTurns,
  );

  const agentInvocation: AgentInvocation = {
    modelName,
    thinking,
    maxTurns: normalizeMaxTurns(resolvedConfig.maxTurns),
    maxRuntimeMinutes: resolvedConfig.maxRuntimeMinutes,
    inheritContext,
    runInBackground,
  };

  const modeLabel = getPromptModeLabel(subagentType, registry);
  const { tags: invocationTags } = buildInvocationTags(agentInvocation);
  const agentTags = modeLabel ? [modeLabel, ...invocationTags] : invocationTags;

  const detailBase = {
    displayName,
    description: params.description as string,
    subagentType,
    modelName,
    tags: agentTags.length > 0 ? agentTags : undefined,
  };

  return {
    identity: { subagentType, rawType, fellBack, displayName },
    execution: {
      prompt: params.prompt as string,
      description: params.description as string,
      model,
      fallbackModels,
      effectiveMaxTurns,
      maxRuntimeMinutes: resolvedConfig.maxRuntimeMinutes,
      thinking,
      inheritContext,
      runInBackground,
      agentInvocation,
    },
    presentation: { modelName, agentTags, detailBase },
  };
}

/** Resolve and de-duplicate an agent definition's ordered fallback model list. */
function resolveFallbackModels(
  inputs: string[] | undefined,
  registry: ModelRegistry | undefined,
  primary: Model<any> | undefined,
): Model<any>[] | string {
  if (!inputs?.length) return [];
  if (!registry) return "No model registry available for fallback models.";

  const resolved: Model<any>[] = [];
  const seen = new Set(primary ? [`${primary.provider}/${primary.id}`.toLowerCase()] : []);
  for (const input of inputs) {
    const candidate = resolveModel(input, registry);
    if (typeof candidate === "string") {
      return `Fallback ${candidate}`;
    }
    const key = `${candidate.provider}/${candidate.id}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(candidate);
    }
  }
  return resolved;
}
