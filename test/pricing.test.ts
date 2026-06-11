import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeModel,
  pricingFor,
  cacheMinimumTokens,
} from "../src/pricing.js";

test("dot notation and provider prefix normalize to bare dashed ids", () => {
  assert.equal(normalizeModel("anthropic/claude-opus-4.8"), "claude-opus-4-8");
  assert.equal(normalizeModel("anthropic/claude-3.5-haiku"), "claude-3-5-haiku");
  assert.equal(normalizeModel("claude-fable-5"), "claude-fable-5");
});

test("mesh catalog prices resolve through prefixed dot ids", () => {
  assert.deepEqual(pricingFor("anthropic/claude-fable-5"), { input: 10, output: 50 });
  assert.deepEqual(pricingFor("anthropic/claude-haiku-4.5"), { input: 0.8, output: 4 });
  assert.deepEqual(pricingFor("anthropic/claude-opus-4.6"), { input: 15, output: 75 });
});

test("cache minimums match on normalized ids", () => {
  assert.equal(cacheMinimumTokens("anthropic/claude-fable-5"), 2048);
  assert.equal(cacheMinimumTokens("anthropic/claude-opus-4.8"), 4096);
  assert.equal(cacheMinimumTokens("anthropic/claude-haiku-4.5"), 4096);
});
