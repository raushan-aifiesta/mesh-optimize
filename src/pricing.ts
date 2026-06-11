/** USD per million tokens. Update alongside provider price changes. */
export interface ModelPricing {
  input: number;
  output: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const DEFAULT_PRICING: ModelPricing = { input: 3, output: 15 };

/** Mesh serves models with provider prefixes ("anthropic/claude-fable-5").
 * All matching happens on the bare model id, lowercased. */
export function normalizeModel(model: string): string {
  const lower = model.toLowerCase();
  const slash = lower.lastIndexOf("/");
  return slash === -1 ? lower : lower.slice(slash + 1);
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
