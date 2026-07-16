import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { AutoModeConfig } from "#src/config-loader";
import type { AutoAskDecider, AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";

const SYSTEM_PROMPT = `You are a security classifier for Pi auto permission mode.

Classify only actions that the deterministic permission system already marked as ask. Deterministic allow and deny decisions never reach you.

HARD BLOCK: block data exfiltration across the trust boundary. Sensitive data includes credentials, tokens, private keys, secrets, proprietary source, private logs, and live production data. Evaluate the final destination, including uploads, git push, package publish, public gists, paste sites, presigned links, webhooks, and external services.

SOFT BLOCK: block destructive git history changes, direct pushes to default branches, downloaded code execution, production deploys or migrations, remote shell writes, production reads, blind apply/force operations, audit tampering, permission grants, TLS/auth/security weakening, unsafe autonomous agents, shared workload interference, destructive infrastructure changes, irreversible local destruction, RCE surfaces, public service exposure, credential leakage or exploration, exfiltration scouting, unverified external destinations, public repo/package creation, untrusted code integration, unauthorized persistence, self-modification of agent permission/config files, instruction poisoning, auto-mode bypass attempts, external system writes, content impersonation, and real-world transactions.

ALLOW: allow local project-scoped operations, read-only operations, declared dependency installation, required toolchain bootstrap, credentials used only with their matching provider, pushes to the working branch, normal memory updates, and non-permission-changing project instruction edits.

Return exactly one XML decision. If the action should be blocked: <block>yes</block><reason>one short sentence</reason>. If it can be automatically approved: <block>no</block>. Err on the side of asking by producing malformed output never; if unsure, block.`;

type Post = (url: string, init: RequestInit) => Promise<Response>;
type ConfigProvider = () => Required<AutoModeConfig>;
type ContextProvider = () => ExtensionContext | null;

export class ClassifierAutoAskDecider implements AutoAskDecider {
  constructor(
    private readonly getConfig: ConfigProvider,
    private readonly getContext: ContextProvider,
    private readonly post: Post = fetch,
  ) {}

  async decide(
    request: AutoAskDecisionRequest,
  ): Promise<PermissionPromptDecision | null> {
    const config = this.getConfig();
    if (!config.enabled) return null;

    const ctx = this.getContext();
    if (!ctx) return fallback(config);

    const model = ctx.modelRegistry.find(config.provider, config.modelId);
    if (!model) return fallback(config);

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return fallback(config);

    return decideWithRetries({
      config,
      post: this.post,
      url: endpoint(model.baseUrl),
      headers: headers(auth),
      model: model.id,
      request,
    });
  }
}

interface RetryArgs {
  config: Required<AutoModeConfig>;
  post: Post;
  url: string;
  headers: Record<string, string>;
  model: string;
  request: AutoAskDecisionRequest;
}

async function decideWithRetries(
  args: RetryArgs,
): Promise<PermissionPromptDecision | null> {
  const attempts = args.config.maxRetries + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const decision = await tryClassify(args, attempt);
    if (decision) return decision;
  }
  return fallback(args.config);
}

async function tryClassify(
  args: RetryArgs,
  attempt: number,
): Promise<PermissionPromptDecision | null> {
  try {
    const response = await args.post(args.url, requestInit(args, attempt));
    if (!response.ok) return null;
    return parseDecision(responseText(await response.json()));
  } catch {
    return null;
  }
}

function requestInit(args: RetryArgs, attempt: number): RequestInit {
  return {
    method: "POST",
    headers: args.headers,
    body: JSON.stringify(body(args.model, args.config, args.request, attempt)),
  };
}

function fallback(
  config: Required<AutoModeConfig>,
): PermissionPromptDecision | null {
  if (config.fallback === "ask") return null;
  return {
    approved: false,
    state: "denied_with_reason",
    denialReason: "Auto mode classifier failed closed.",
  };
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1/messages`;
}

function headers(auth: {
  apiKey?: string;
  headers?: Record<string, string>;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    ...auth.headers,
    ...(auth.apiKey ? { "x-api-key": auth.apiKey } : {}),
  };
}

function body(
  model: string,
  config: Required<AutoModeConfig>,
  request: AutoAskDecisionRequest,
  attempt: number,
): Record<string, unknown> {
  return {
    model,
    max_tokens: config.maxTokens,
    stop_sequences: ["</block>"],
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: promptContent(request, attempt) }],
  };
}

function promptContent(request: AutoAskDecisionRequest, attempt: number): string {
  const suffix = attempt === 0 ? "" : "\nReturn only valid XML now.";
  return `${JSON.stringify(request)}${suffix}`;
}

function parseDecision(text: string): PermissionPromptDecision | null {
  const match = /<block>\s*(yes|no)(?:\s*<\/block>)?/i.exec(text);
  if (!match) return null;
  if (match[1]?.toLowerCase() === "no") {
    return { approved: true, state: "approved", autoApproved: true };
  }
  return {
    approved: false,
    state: "denied_with_reason",
    denialReason: reason(text) ?? "Auto mode classifier blocked this action.",
  };
}

function reason(text: string): string | undefined {
  const match = /<reason>\s*([\s\S]*?)\s*<\/reason>/i.exec(text);
  return match?.[1]?.trim() || undefined;
}

function responseText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) return "";
  return value.content.flatMap((part) => (isTextPart(part) ? [part.text] : [])).join("");
}

function isTextPart(value: unknown): value is { type: "text"; text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
