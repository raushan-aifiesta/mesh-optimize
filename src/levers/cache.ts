import type { AuditEntry, ChatMessage, MeshRequest } from "../types.js";
import { estimateTokens, estimateConversationTokens } from "../estimate.js";
import { cacheMinimumTokens } from "../pricing.js";

const EPHEMERAL = { type: "ephemeral" } as const;

function hasClientBreakpoints(request: MeshRequest): boolean {
  if (Array.isArray(request.system)) {
    if (request.system.some((b: any) => b && b.cache_control)) return true;
  }
  return (request.messages ?? []).some((m) => m.cache_control !== undefined);
}

/** Dial 0+. Injects deterministic cache_control breakpoints:
 *  1. after the system prompt, when it clears the model's cacheable minimum
 *  2. on the last history message before the final user turn, when the
 *     accumulated prefix clears the minimum
 *
 * Skips entirely when the client already placed breakpoints - they know
 * their prefix better than a heuristic does. Same request bytes in, same
 * breakpoints out, always. */
export function applyCacheInjection(
  request: MeshRequest,
  audit: AuditEntry[],
): boolean {
  if (hasClientBreakpoints(request)) {
    audit.push({
      lever: "cache_injection",
      action: "skipped: client already set cache_control",
    });
    return false;
  }

  const minimum = cacheMinimumTokens(request.model);
  let applied = false;

  const systemTokens = estimateTokens(request.system);
  if (typeof request.system === "string" && systemTokens >= minimum) {
    request.system = [
      { type: "text", text: request.system, cache_control: { ...EPHEMERAL } },
    ];
    audit.push({
      lever: "cache_injection",
      action: `breakpoint after system prompt (~${systemTokens} tokens)`,
    });
    applied = true;
  } else if (Array.isArray(request.system) && systemTokens >= minimum) {
    const last = request.system[request.system.length - 1] as
      | Record<string, unknown>
      | undefined;
    if (last && typeof last === "object") {
      last.cache_control = { ...EPHEMERAL };
      audit.push({
        lever: "cache_injection",
        action: `breakpoint on last system block (~${systemTokens} tokens)`,
      });
      applied = true;
    }
  }

  const messages = request.messages ?? [];

  // OpenAI-shape traffic carries the system prompt as messages[0]
  const first = messages[0];
  if (!applied && first && first.role === "system") {
    const firstTokens = estimateTokens(first.content);
    if (firstTokens >= minimum) {
      first.cache_control = { ...EPHEMERAL };
      audit.push({
        lever: "cache_injection",
        action: `breakpoint on system message (~${firstTokens} tokens)`,
      });
      applied = true;
    }
  }

  if (messages.length >= 3) {
    const history = messages.slice(0, -1);
    const prefixTokens = systemTokens + estimateConversationTokens(history);
    const anchor = history[history.length - 1] as ChatMessage;
    if (prefixTokens >= minimum && anchor.cache_control === undefined) {
      anchor.cache_control = { ...EPHEMERAL };
      audit.push({
        lever: "cache_injection",
        action: `breakpoint on conversation history (~${prefixTokens} token prefix)`,
      });
      applied = true;
    }
  }

  return applied;
}
