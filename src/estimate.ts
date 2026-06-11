import type { ChatMessage } from "./types.js";

export const ESTIMATE_METHOD = "pre_optimization_char_estimate_div4";

/** Cheap token estimate: serialized chars / 4. Never used for billing,
 * only for lever thresholds and the savings baseline. */
export function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: ChatMessage): number {
  return estimateTokens(message.content) + 4;
}

export function estimateConversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}
