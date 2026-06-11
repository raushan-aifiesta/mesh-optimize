import type { ChatMessage, MeshRequest, TaskClass } from "./types.js";
import { estimateConversationTokens } from "./estimate.js";

const CODE_PATTERN = /```|(?:\bfunction\b|\bclass\b|\bimport\b|\bdef\b)\s/;
const COMPLEX_KEYWORDS =
  /\b(refactor|implement|debug|architect|migrate|optimi[sz]e|analy[sz]e|design doc|root cause)\b/i;

const CLASSIFIER_BUDGET_MS = 100;

function textOf(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content ?? "");
}

/** Heuristic v1 classifier. Must stay under 100ms; on overrun it fails open
 * by returning "standard", which triggers no downgrades. */
export function classify(request: MeshRequest): TaskClass {
  const started = Date.now();
  const messages = request.messages ?? [];
  const hasTools = Array.isArray(request.tools) && request.tools.length > 0;
  const depth = messages.length;

  let sample = "";
  for (const message of messages.slice(-6)) {
    if (Date.now() - started > CLASSIFIER_BUDGET_MS) return "standard";
    sample += textOf(message).slice(0, 4000) + "\n";
  }

  if (hasTools && depth > 6) return "agentic";
  if (hasTools) return "complex";
  if (CODE_PATTERN.test(sample) || COMPLEX_KEYWORDS.test(sample)) {
    return "complex";
  }

  const estTokens = estimateConversationTokens(messages.slice(-6));
  if (estTokens < 150 && depth <= 4) return "routine";
  return "standard";
}
