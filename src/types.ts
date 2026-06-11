export type TaskClass = "routine" | "standard" | "complex" | "agentic";

export interface MeshHints {
  /** "flexible" unlocks batch routing at any dial value. Default "realtime". */
  latency?: "realtime" | "flexible";
  /** Stable id for requests belonging to the same conversation. Enables
   * cross-turn cache placement and, later, pre-warming. */
  session_id?: string;
}

export interface ChatMessage {
  role: string;
  content: unknown;
  cache_control?: { type: string; ttl?: string };
  [key: string]: unknown;
}

/** OpenAI-compatible request body plus the Mesh extensions. Anthropic-native
 * fields (system, tools, thinking) pass through untouched unless a lever or
 * guard owns them. */
export interface MeshRequest {
  model: string;
  messages: ChatMessage[];
  mesh_optimize?: number;
  mesh_hints?: MeshHints;
  max_tokens?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  thinking?: { type?: string; [key: string]: unknown };
  output_config?: { effort?: string; [key: string]: unknown };
  system?: unknown;
  tools?: unknown[];
  [key: string]: unknown;
}

export interface AuditEntry {
  lever: string;
  action: string;
  /** sha256 of any content the lever removed or rewrote, so "why did the
   * model forget X" is answerable without storing the content itself. */
  content_sha256?: string;
  detail?: string;
}

export interface OptimizePlan {
  dial: number;
  model: string;
  classification: TaskClass;
  leversApplied: string[];
  batchEligible: boolean;
  /** Input tokens the levers removed from the request, chars/4 estimate. */
  estimatedTokensRemoved: number;
  baselineEstimateMethod: string;
  audit: AuditEntry[];
}

export interface MeshSavings {
  tokens_saved: number;
  cost_saved_usd: number;
  levers_applied: string[];
  baseline_estimate_method: string;
}

/** Usage block from either an OpenAI-shape or Anthropic-shape response. */
export interface ProviderUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  [key: string]: unknown;
}

export interface ProviderResponse {
  usage?: ProviderUsage;
  [key: string]: unknown;
}

export interface PrepareResult {
  request: MeshRequest;
  plan: OptimizePlan;
}
