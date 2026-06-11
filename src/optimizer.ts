import type {
  AuditEntry,
  MeshRequest,
  OptimizePlan,
  PrepareResult,
} from "./types.js";
import { classify } from "./classifier.js";
import { applyFableGuards } from "./guards.js";
import { applyCacheInjection } from "./levers/cache.js";
import { applyMaxTokensDefault } from "./levers/maxTokens.js";
import { applyEffortRouting } from "./levers/effort.js";
import { applyToolResultPruning } from "./levers/prune.js";
import { ESTIMATE_METHOD } from "./estimate.js";

export interface MeshOptimizerOptions {
  /** Dashboard default for the API key. Per-request mesh_optimize wins. */
  defaultDial?: number;
}

function clampDial(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(0.95, Math.max(0, value));
}

export class MeshOptimizer {
  private readonly defaultDial: number;

  constructor(options: MeshOptimizerOptions = {}) {
    this.defaultDial = clampDial(options.defaultDial ?? 0);
  }

  /** Intercept a request on its way to the provider. Returns the rewritten
   * request plus the plan needed to attach mesh_savings to the response.
   * Deterministic: identical input always produces identical output.
   *
   * mesh_optimize: 0 is the contractual opt-out - the request passes
   * through byte-identical, no guards, no levers. */
  prepare(original: MeshRequest): PrepareResult {
    const dial =
      original.mesh_optimize !== undefined
        ? clampDial(original.mesh_optimize)
        : this.defaultDial;
    const hints = original.mesh_hints ?? {};

    const plan: OptimizePlan = {
      dial,
      model: original.model,
      classification: "standard",
      leversApplied: [],
      batchEligible: false,
      estimatedTokensRemoved: 0,
      baselineEstimateMethod: ESTIMATE_METHOD,
      audit: [],
    };

    if (dial === 0) {
      return { request: original, plan };
    }

    const request: MeshRequest = structuredClone(original);
    delete request.mesh_optimize;
    delete request.mesh_hints;
    const audit: AuditEntry[] = plan.audit;

    plan.classification = classify(request);
    applyFableGuards(request, audit);

    if (dial >= 0.2) {
      const removed = applyToolResultPruning(request, audit);
      if (removed > 0) {
        plan.estimatedTokensRemoved += removed;
        plan.leversApplied.push("tool_result_pruning");
      }
    }

    if (applyCacheInjection(request, audit)) {
      plan.leversApplied.push("cache_injection");
    }
    if (applyMaxTokensDefault(request, plan.classification, audit)) {
      plan.leversApplied.push("max_tokens_default");
    }
    if (applyEffortRouting(request, dial, plan.classification, audit)) {
      plan.leversApplied.push("effort_downgrade");
    }

    if (hints.latency === "flexible") {
      plan.batchEligible = true;
      plan.leversApplied.push("batch_eligible");
      audit.push({
        lever: "batch_routing",
        action: "marked batch eligible via latency:flexible hint",
      });
    }

    if (dial >= 0.4) {
      audit.push({
        lever: "context_compaction",
        action: "skipped: ships in phase two",
      });
      audit.push({
        lever: "subagent_caps",
        action: "skipped: ships in phase two",
      });
    }
    if (dial >= 0.6) {
      audit.push({
        lever: "model_routing",
        action: "skipped: ships in phase three",
      });
    }

    return { request, plan };
  }
}
