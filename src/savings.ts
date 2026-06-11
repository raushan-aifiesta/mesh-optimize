import type {
  MeshSavings,
  OptimizePlan,
  ProviderResponse,
  ProviderUsage,
} from "./types.js";
import { pricingFor } from "./pricing.js";

const CACHE_READ_DISCOUNT = 0.9;
const CACHE_WRITE_PREMIUM = 0.25;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Honest math, per the spec:
 *  - pruned tokens count as tokens_saved at full input price (they would
 *    have been billed otherwise; chars/4 estimate, method disclosed)
 *  - cache reads do not reduce the token count, they reduce the price:
 *    90% discount on reads minus the 25% premium we caused on writes
 *  - cost_saved_usd can go slightly negative on a cold cache write; we
 *    report it as is rather than clamping, because never inflate */
export function computeSavings(
  plan: OptimizePlan,
  response: ProviderResponse,
): MeshSavings {
  const usage: ProviderUsage = response.usage ?? {};
  const price = pricingFor(plan.model);
  const perInputToken = price.input / 1_000_000;

  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  const prunedCost = plan.estimatedTokensRemoved * perInputToken;
  const cacheCost =
    cacheRead * perInputToken * CACHE_READ_DISCOUNT -
    cacheWrite * perInputToken * CACHE_WRITE_PREMIUM;

  return {
    tokens_saved: plan.estimatedTokensRemoved,
    cost_saved_usd: round4(prunedCost + cacheCost),
    levers_applied: plan.leversApplied,
    baseline_estimate_method: plan.baselineEstimateMethod,
  };
}

/** Returns a shallow copy of the provider response with mesh_savings
 * attached. The original response object is not mutated. */
export function attachSavings<T extends ProviderResponse>(
  plan: OptimizePlan,
  response: T,
): T & { mesh_savings: MeshSavings } {
  return { ...response, mesh_savings: computeSavings(plan, response) };
}
