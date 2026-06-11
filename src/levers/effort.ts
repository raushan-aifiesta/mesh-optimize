import type { AuditEntry, MeshRequest, TaskClass } from "../types.js";
import { isAnthropicModel } from "../pricing.js";

/** Dial 0.2+: routine tasks get effort medium. Dial 0.6+: routine drops to
 * low and standard drops to medium. Anthropic models only - the lever
 * degrades to a no-op everywhere else. Never overrides a client-set value. */
export function applyEffortRouting(
  request: MeshRequest,
  dial: number,
  classification: TaskClass,
  audit: AuditEntry[],
): boolean {
  if (!isAnthropicModel(request.model)) return false;
  if (request.output_config?.effort !== undefined) return false;

  let effort: string | undefined;
  if (dial >= 0.6 && classification === "routine") effort = "low";
  else if (dial >= 0.6 && classification === "standard") effort = "medium";
  else if (dial >= 0.2 && classification === "routine") effort = "medium";

  if (!effort) return false;
  request.output_config = { ...request.output_config, effort };
  audit.push({
    lever: "effort_downgrade",
    action: `effort=${effort} for ${classification} task at dial ${dial}`,
  });
  return true;
}
