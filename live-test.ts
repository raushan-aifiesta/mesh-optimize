/**
 * Live bill comparison against the real Mesh API.
 *
 * Sends the same agentic conversation three times:
 *   1. dial 0    - baseline, exactly what the client sent
 *   2. dial 0.3  - optimized, cold cache (first request pays the write premium)
 *   3. dial 0.3  - optimized, warm cache (where agentic traffic lives)
 *
 * Run: npx tsx live-test.ts
 *
 * Env (process env or a .env file next to this script):
 *   MESH_API_KEY   required
 *   MESH_BASE_URL  default https://api.meshapi.ai/v1
 *   MESH_MODEL     default anthropic/claude-fable-5
 */
import { readFileSync } from "node:fs";
import { MeshOptimizer, attachSavings, pricingFor } from "./src/index.js";
import type { MeshRequest, ProviderUsage } from "./src/index.js";

// minimal .env loader, no dependency
try {
  for (const line of readFileSync(new URL(".env", import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#]*)"?\s*$/);
    if (match && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!.trim();
    }
  }
} catch {
  // no .env file, rely on process env
}

const API_KEY = process.env.MESH_API_KEY;
const BASE_URL = process.env.MESH_BASE_URL ?? "https://api.meshapi.ai/v1";
const MODEL = process.env.MESH_MODEL ?? "anthropic/claude-fable-5";

if (!API_KEY) {
  console.error("MESH_API_KEY is not set. Export it or put it in a .env file:");
  console.error('  echo \'MESH_API_KEY="your-key"\' > .env');
  process.exit(1);
}

function conversation(): MeshRequest {
  return {
    model: MODEL,
    max_tokens: 300, // keep the live test cheap; the lever defers to client values
    system:
      "You are a careful coding agent for a TypeScript monorepo. " +
      "Follow the house style guide strictly. ".repeat(300),
    messages: [
      { role: "user", content: "fix the failing test in auth.ts" },
      { role: "assistant", content: "Let me look at the test output first." },
      { role: "tool", content: "FAIL auth.test.ts > rejects expired tokens\n".repeat(400) },
      { role: "assistant", content: "The expiry check uses seconds, the token uses ms. Patching." },
      { role: "user", content: "also run the linter" },
      { role: "assistant", content: "Linter is clean, two warnings auto-fixed." },
      { role: "user", content: "summarize the current status in one line" },
    ],
  };
}

interface CallResult {
  label: string;
  usage: ProviderUsage;
  costUsd: number;
  ms: number;
  receipt?: unknown;
}

function costOf(usage: ProviderUsage, model: string): number {
  const price = pricingFor(model);
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (input * price.input +
      output * price.output +
      cacheRead * price.input * 0.1 +
      cacheWrite * price.input * 1.25) /
    1_000_000
  );
}

async function callMesh(body: Record<string, unknown>, label: string): Promise<CallResult> {
  const started = Date.now();
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`\n[${label}] HTTP ${response.status}`);
    console.error(JSON.stringify(json, null, 2).slice(0, 2000));
    process.exit(1);
  }
  const usage: ProviderUsage = json.usage ?? {};
  return { label, usage, costUsd: costOf(usage, MODEL), ms };
}

function printResult(r: CallResult): void {
  const u = r.usage;
  console.log(`\n${r.label}  (${r.ms}ms)`);
  console.log(`  input tokens:        ${u.input_tokens ?? u.prompt_tokens ?? 0}`);
  console.log(`  output tokens:       ${u.output_tokens ?? u.completion_tokens ?? 0}`);
  console.log(`  cache read tokens:   ${u.cache_read_input_tokens ?? 0}`);
  console.log(`  cache write tokens:  ${u.cache_creation_input_tokens ?? 0}`);
  console.log(`  cost:                $${r.costUsd.toFixed(6)}`);
}

const optimizer = new MeshOptimizer();

console.log(`model: ${MODEL}`);
console.log(`endpoint: ${BASE_URL}/chat/completions`);

// 1. baseline at dial 0
const baselineBody = { ...conversation(), mesh_optimize: 0 };
const baseline = await callMesh(baselineBody, "1. baseline (dial 0)");
printResult(baseline);

// 2. optimized, cold cache
const { request: optimized, plan } = optimizer.prepare({
  ...conversation(),
  mesh_optimize: 0.3,
});
console.log(`\nlevers applied locally: ${plan.leversApplied.join(", ")}`);
const cold = await callMesh(optimized as Record<string, unknown>, "2. optimized, cold cache (dial 0.3)");
printResult(cold);

// 3. optimized again, warm cache. prepare() is deterministic, so the bytes
// are identical and the breakpoints written in call 2 should now be read.
const { request: optimizedAgain, plan: plan2 } = optimizer.prepare({
  ...conversation(),
  mesh_optimize: 0.3,
});
const warm = await callMesh(optimizedAgain as Record<string, unknown>, "3. optimized, warm cache (dial 0.3)");
printResult(warm);

const receipt = attachSavings(plan2, { usage: warm.usage });
console.log("\nmesh_savings receipt for call 3:");
console.log(JSON.stringify(receipt.mesh_savings, null, 2));

const delta = baseline.costUsd - warm.costUsd;
const pct = baseline.costUsd > 0 ? (delta / baseline.costUsd) * 100 : 0;
console.log("\n================ bill comparison ================");
console.log(`baseline (dial 0):        $${baseline.costUsd.toFixed(6)}`);
console.log(`optimized warm (dial 0.3): $${warm.costUsd.toFixed(6)}`);
console.log(`saved per request:         $${delta.toFixed(6)}  (${pct.toFixed(1)}%)`);
console.log("=================================================");
if ((warm.usage.cache_read_input_tokens ?? 0) === 0) {
  console.log(
    "\nnote: cache read tokens were 0 on the warm call. either the gateway is " +
      "not forwarding cache_control to the provider yet, or it does not " +
      "surface anthropic cache fields in usage. both are gateway-side items, " +
      "not client-side.",
  );
}
