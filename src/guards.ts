import type { AuditEntry, MeshRequest } from "./types.js";
import { isFableModel } from "./pricing.js";

/** Fable 5 rejects params other models tolerate. The optimizer must never be
 * the reason a request 400s, so strip them before forwarding. Runs at every
 * dial value including 0 only when the optimizer is active (dial > 0 callers
 * get it as part of prepare; dial 0 bypasses everything per the opt-out rule). */
export function applyFableGuards(
  request: MeshRequest,
  audit: AuditEntry[],
): void {
  if (!isFableModel(request.model)) return;

  if (request.temperature !== undefined && request.temperature !== 1) {
    delete request.temperature;
    audit.push({
      lever: "param_guard",
      action: "removed temperature (fable requires 1.0 or unset)",
    });
  }
  if (request.top_k !== undefined) {
    delete request.top_k;
    audit.push({
      lever: "param_guard",
      action: "removed top_k (unsupported on fable)",
    });
  }
  if (request.thinking?.type === "disabled") {
    delete request.thinking;
    audit.push({
      lever: "param_guard",
      action: "removed thinking:disabled (fable rejects it; omitted instead)",
    });
  }
}
