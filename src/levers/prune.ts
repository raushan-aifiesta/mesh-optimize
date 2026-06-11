import { createHash } from "node:crypto";
import type { AuditEntry, ChatMessage, MeshRequest } from "../types.js";

const KEEP_RECENT_MESSAGES = 4;
const TRUNCATE_TO_CHARS = 400;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isToolResult(message: ChatMessage): boolean {
  if (message.role === "tool") return true;
  if (Array.isArray(message.content)) {
    return message.content.some(
      (block: any) => block && block.type === "tool_result",
    );
  }
  return false;
}

function truncateText(text: string): string {
  return (
    text.slice(0, TRUNCATE_TO_CHARS) +
    `\n[mesh: pruned ${text.length - TRUNCATE_TO_CHARS} chars of consumed tool output]`
  );
}

/** Dial 0.2+. Tool results older than the last four messages have already
 * been consumed by the model in a prior turn; the full payload is dead
 * weight on every subsequent request. Truncate them deterministically.
 *
 * Ordering matters: pruning runs BEFORE cache injection so breakpoints are
 * placed on the final bytes. The optimizer never rewrites content sitting
 * inside an existing client-set breakpoint - that case skips injection and
 * pruning both (checked by the caller).
 *
 * Returns the estimated number of input tokens removed. */
export function applyToolResultPruning(
  request: MeshRequest,
  audit: AuditEntry[],
): number {
  const messages = request.messages ?? [];
  const cutoff = messages.length - KEEP_RECENT_MESSAGES;
  let charsRemoved = 0;

  for (let i = 0; i < cutoff; i++) {
    const message = messages[i] as ChatMessage;
    if (!isToolResult(message)) continue;

    if (
      typeof message.content === "string" &&
      message.content.length > TRUNCATE_TO_CHARS * 2
    ) {
      const original = message.content;
      const truncated = truncateText(original);
      message.content = truncated;
      charsRemoved += original.length - truncated.length;
      audit.push({
        lever: "tool_result_pruning",
        action: `truncated tool result at message ${i}`,
        content_sha256: sha256(original),
        detail: `${original.length} chars to ${truncated.length}`,
      });
    } else if (Array.isArray(message.content)) {
      for (const block of message.content as any[]) {
        if (
          block?.type === "tool_result" &&
          typeof block.content === "string" &&
          block.content.length > TRUNCATE_TO_CHARS * 2
        ) {
          const original = block.content;
          block.content = truncateText(original);
          charsRemoved += original.length - block.content.length;
          audit.push({
            lever: "tool_result_pruning",
            action: `truncated tool_result block at message ${i}`,
            content_sha256: sha256(original),
            detail: `${original.length} chars to ${block.content.length}`,
          });
        }
      }
    }
  }

  return Math.ceil(charsRemoved / 4);
}
