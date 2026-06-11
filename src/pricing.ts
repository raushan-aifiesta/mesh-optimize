/** USD per million tokens. Update alongside provider price changes. */
export interface ModelPricing {
  input: number;
  output: number;
}

/** Prices are what the customer pays Mesh, per the catalog at
 * developers.meshapi.ai, not the provider's list prices. Keys are
 * normalized ids (bare, lowercase, dots to dashes). */
const PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
};

const DEFAULT_PRICING: ModelPricing = { input: 3, output: 15 };

/** Mesh serves models as "anthropic/claude-opus-4.8": provider prefix,
 * dot version notation. All matching happens on the bare id, lowercased,
 * dots converted to dashes. */
export function normalizeModel(model: string): string {
  const lower = model.toLowerCase();
  const slash = lower.lastIndexOf("/");
  const bare = slash === -1 ? lower : lower.slice(slash + 1);
  return bare.replaceAll(".", "-");
}

export function pricingFor(model: string): ModelPricing {
  return PRICING[normalizeModel(model)] ?? DEFAULT_PRICING;
}

/** Minimum cacheable prefix in tokens. Below this, cache_control silently
 * does nothing, so injecting it would be pure noise. */
const CACHE_MINIMUMS: Array<[RegExp, number]> = [
  [/fable/, 2048],
  [/sonnet-4-6/, 2048],
  [/opus/, 4096],
  [/haiku-4-5/, 4096],
];

export function cacheMinimumTokens(model: string): number {
  const bare = normalizeModel(model);
  for (const [pattern, min] of CACHE_MINIMUMS) {
    if (pattern.test(bare)) return min;
  }
  return 2048;
}

export function isAnthropicModel(model: string): boolean {
  return normalizeModel(model).startsWith("claude");
}

export function isFableModel(model: string): boolean {
  return normalizeModel(model).includes("fable");
}
