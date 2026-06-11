import { test } from "node:test";
import assert from "node:assert/strict";
import { attachSavings, computeSavings } from "../src/savings.js";
import type { OptimizePlan } from "../src/types.js";

function plan(overrides: Partial<OptimizePlan> = {}): OptimizePlan {
  return {
    dial: 0.3,
    model: "claude-fable-5",
    classification: "agentic",
    leversApplied: ["cache_injection", "tool_result_pruning"],
    batchEligible: false,
    estimatedTokensRemoved: 1000,
    baselineEstimateMethod: "pre_optimization_char_estimate_div4",
    audit: [],
    ...overrides,
  };
}

test("cache reads count at the 90% discount, writes subtract the 25% premium", () => {
  const savings = computeSavings(plan({ estimatedTokensRemoved: 0 }), {
    usage: {
      input_tokens: 500,
      cache_read_input_tokens: 100_000,
      cache_creation_input_tokens: 10_000,
      output_tokens: 800,
    },
  });
  // fable input: $10/M. read: 100k * 10/1M * 0.9 = 0.9; write: 10k * 10/1M * 0.25 = 0.025
  assert.equal(savings.cost_saved_usd, 0.875);
  assert.equal(savings.tokens_saved, 0);
});

test("pruned tokens count at full input price and as tokens_saved", () => {
  const savings = computeSavings(plan(), { usage: { input_tokens: 500 } });
  // 1000 tokens * $10/M = 0.01
  assert.equal(savings.cost_saved_usd, 0.01);
  assert.equal(savings.tokens_saved, 1000);
});

test("cold cache write can go negative; reported honestly, not clamped", () => {
  const savings = computeSavings(plan({ estimatedTokensRemoved: 0 }), {
    usage: { cache_creation_input_tokens: 120_000 },
  });
  assert.ok(savings.cost_saved_usd < 0);
});

test("attachSavings does not mutate the provider response", () => {
  const response = { usage: { input_tokens: 10 }, id: "msg_1" };
  const enriched = attachSavings(plan(), response);
  assert.equal((response as any).mesh_savings, undefined);
  assert.ok(enriched.mesh_savings);
  assert.equal(enriched.id, "msg_1");
  assert.equal(
    enriched.mesh_savings.baseline_estimate_method,
    "pre_optimization_char_estimate_div4",
  );
});
