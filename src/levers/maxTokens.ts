import type { AuditEntry, MeshRequest, TaskClass } from "../types.js";

const DEFAULTS: Record<TaskClass, number> = {
  routine: 1024,
  standard: 1024,
  complex: 4096,
  agentic: 4096,
};

/** Dial 0+. Sets max_tokens only when the client did not. A default is a
 * backstop against runaway generation, never a cap on a real answer: the
 * gateway watches stop_reason and raises the default for a traffic class
 * whenever it actually truncates. */
export function applyMaxTokensDefault(
  request: MeshRequest,
  classification: TaskClass,
  audit: AuditEntry[],
): boolean {
  if (request.max_tokens !== undefined) return false;
  request.max_tokens = DEFAULTS[classification];
  audit.push({
    lever: "max_tokens_default",
    action: `set max_tokens=${request.max_tokens} for ${classification} task`,
  });
  return true;
}
