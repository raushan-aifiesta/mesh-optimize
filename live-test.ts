/**
 * Live bill comparison against the real Mesh API.
 *
 * Sends the same agentic conversation three times:
 *   1. baseline      - exactly what a client would send today
 *   2. optimized     - dial 0.3, cold cache (first request pays the write premium)
 *   3. optimized     - dial 0.3, warm cache (where agentic traffic lives)
 *
 * Request shape follows the published schema at developers.meshapi.ai:
 * system prompt as messages[0], tool messages carry tool_call_id, tools in
 * OpenAI function format. mesh_optimize is never sent over the wire; this
 * package IS the middleware, so optimization happens locally before send.
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
    tools: [
      {
        type: "function",
        function: {
          name: "bash",
          description: "Run a shell command in the repository",
          parameters: {
            type: "object",
            properties: { cmd: { type: "string" } },
            required: ["cmd"],
          },
        },
      },
    ],
    messages: [
      {
        role: "system",
        content:
          "You are a careful coding agent for a TypeScript monorepo. " +
          "Follow the house style guide strictly. ".repeat(300),
      },
      { role: "user", content: "fix the failing test in auth.ts" },
      {
        role: "assistant",
        content: "Running the test suite first.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "bash", arguments: '{"cmd":"npm test"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "FAIL auth.test.ts > rejects expired tokens\n".repeat(400),
      },
      {
        role: "assistant",
        content: "The expiry check uses seconds, the token uses ms. Patching.",
      },
      { role: "user", content: "also run the linter" },
      { role: "assistant", content: "Linter is clean." },
      { role: "user", content: "summarize the current status in one line" },
    ],
  };
}

interface CallResult {
  label: string;
  usage: ProviderUsage;
  costUsd: number;
  ms: number;
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

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: any; ms: number }> {
  const started = Date.now();
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json: any = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json, ms: Date.now() - started };
}

async function callMesh(body: Record<string, unknown>, label: string): Promise<CallResult> {
  const result = await post(body);
  if (!result.ok) {
    console.error(`\n[${label}] HTTP ${result.status}`);
    console.error(JSON.stringify(result.json, null, 2).slice(0, 1500));

    // diagnose: does a minimal request work at all?
    const probe = await post({
      model: MODEL,
      max_tokens: 50,
      messages: [{ role: "user", content: "say ok" }],
    });
    if (probe.ok) {
      console.error(
        "\ndiagnosis: a minimal request to the same model succeeds, so the " +
          "failure is something in this request's shape. if this is call 2 or 3, " +
          "the gateway likely rejects the injected cache_control fields, which " +
          "means cache passthrough needs gateway-side support before phase 1 ships.",
      );
    } else {
      console.error(
        `\ndiagnosis: even a minimal request fails (HTTP ${probe.status}), so the ` +
          "model or endpoint is the problem, not the request shape. try " +
          "MESH_MODEL=anthropic/claude-sonnet-4.6 or check the key.",
      );
    }
    process.exit(1);
  }
  const usage: ProviderUsage = result.json.usage ?? {};
  return { label, usage, costUsd: costOf(usage, MODEL), ms: result.ms };
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

// 1. baseline: the raw request, untouched
const baseline = await callMesh(conversation() as Record<string, unknown>, "1. baseline");
printResult(baseline);

// 2. optimized locally at dial 0.3, cold cache
const { request: optimized, plan } = optimizer.prepare({
  ...conversation(),
  mesh_optimize: 0.3,
});
console.log(`\nlevers applied locally: ${plan.leversApplied.join(", ")}`);
console.log(`estimated tokens pruned: ${plan.estimatedTokensRemoved}`);
const cold = await callMesh(optimized as Record<string, unknown>, "2. optimized, cold cache");
printResult(cold);

// 3. optimized again, warm cache. prepare() is deterministic, so the bytes
// are identical and the breakpoints written in call 2 should now be read.
const { request: optimizedAgain, plan: plan2 } = optimizer.prepare({
  ...conversation(),
  mesh_optimize: 0.3,
});
const warm = await callMesh(optimizedAgain as Record<string, unknown>, "3. optimized, warm cache");
printResult(warm);

const receipt = attachSavings(plan2, { usage: warm.usage });
console.log("\nmesh_savings receipt for call 3:");
console.log(JSON.stringify(receipt.mesh_savings, null, 2));

const delta = baseline.costUsd - warm.costUsd;
const pct = baseline.costUsd > 0 ? (delta / baseline.costUsd) * 100 : 0;
console.log("\n================ bill comparison ================");
console.log(`baseline:                  $${baseline.costUsd.toFixed(6)}`);
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
