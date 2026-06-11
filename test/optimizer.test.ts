import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshOptimizer } from "../src/optimizer.js";
import type { MeshRequest } from "../src/types.js";

const bigSystem = "You are a coding agent. ".repeat(600); // ~14k chars, ~3.6k tokens

function agenticRequest(): MeshRequest {
  return {
    model: "claude-fable-5",
    mesh_optimize: 0.3,
    system: bigSystem,
    messages: [
      { role: "user", content: "fix the failing test in auth.ts" },
      { role: "assistant", content: "Let me look at the file." },
      { role: "tool", content: "x".repeat(5000) },
      { role: "assistant", content: "Found it, patching now." },
      { role: "user", content: "also run the linter" },
      { role: "assistant", content: "Running." },
      { role: "user", content: "status?" },
    ],
    tools: [{ name: "bash" }],
    temperature: 0.7,
    top_k: 40,
  };
}

test("dial 0 is a byte-identical passthrough", () => {
  const optimizer = new MeshOptimizer();
  const request: MeshRequest = {
    model: "claude-fable-5",
    mesh_optimize: 0,
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.7,
  };
  const { request: out, plan } = optimizer.prepare(request);
  assert.equal(out, request);
  assert.deepEqual(plan.leversApplied, []);
});

test("deterministic: same input gives same output", () => {
  const optimizer = new MeshOptimizer();
  const a = optimizer.prepare(agenticRequest());
  const b = optimizer.prepare(agenticRequest());
  assert.deepEqual(a.request, b.request);
  assert.deepEqual(a.plan, b.plan);
});

test("original request object is never mutated", () => {
  const optimizer = new MeshOptimizer();
  const request = agenticRequest();
  const snapshot = structuredClone(request);
  optimizer.prepare(request);
  assert.deepEqual(request, snapshot);
});

test("fable guards strip temperature, top_k, thinking:disabled", () => {
  const optimizer = new MeshOptimizer();
  const request = agenticRequest();
  request.thinking = { type: "disabled" };
  const { request: out } = optimizer.prepare(request);
  assert.equal(out.temperature, undefined);
  assert.equal(out.top_k, undefined);
  assert.equal(out.thinking, undefined);
});

test("cache injection converts large string system prompt and marks history", () => {
  const optimizer = new MeshOptimizer();
  const { request: out, plan } = optimizer.prepare(agenticRequest());
  assert.ok(Array.isArray(out.system));
  assert.deepEqual((out.system as any[])[0].cache_control, {
    type: "ephemeral",
  });
  const history = out.messages[out.messages.length - 2] as any;
  assert.deepEqual(history.cache_control, { type: "ephemeral" });
  assert.ok(plan.leversApplied.includes("cache_injection"));
});

test("cache injection defers to client-set breakpoints", () => {
  const optimizer = new MeshOptimizer();
  const request = agenticRequest();
  (request.messages[0] as any).cache_control = { type: "ephemeral" };
  const { plan } = optimizer.prepare(request);
  assert.ok(!plan.leversApplied.includes("cache_injection"));
});

test("small prompts get no breakpoint (below cacheable minimum)", () => {
  const optimizer = new MeshOptimizer();
  const { request: out, plan } = optimizer.prepare({
    model: "claude-fable-5",
    mesh_optimize: 0.2,
    system: "be brief",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(typeof out.system, "string");
  assert.ok(!plan.leversApplied.includes("cache_injection"));
});

test("old tool results pruned, recent ones kept", () => {
  const optimizer = new MeshOptimizer();
  const { request: out, plan } = optimizer.prepare(agenticRequest());
  const pruned = out.messages[2] as any;
  assert.ok(pruned.content.includes("[mesh: pruned"));
  assert.ok(pruned.content.length < 5000);
  assert.ok(plan.estimatedTokensRemoved > 1000);
  assert.ok(plan.leversApplied.includes("tool_result_pruning"));
  const auditEntry = plan.audit.find(
    (e) => e.lever === "tool_result_pruning",
  );
  assert.ok(auditEntry?.content_sha256);
});

test("pruning does not run below dial 0.2", () => {
  const optimizer = new MeshOptimizer();
  const request = agenticRequest();
  request.mesh_optimize = 0.1;
  const { request: out } = optimizer.prepare(request);
  assert.equal((out.messages[2] as any).content.length, 5000);
});

test("max_tokens default respects client value", () => {
  const optimizer = new MeshOptimizer();
  const request = agenticRequest();
  request.max_tokens = 9999;
  const { request: out } = optimizer.prepare(request);
  assert.equal(out.max_tokens, 9999);
});

test("effort downgrade hits routine tasks at 0.2+, anthropic only", () => {
  const optimizer = new MeshOptimizer();
  const routine: MeshRequest = {
    model: "claude-fable-5",
    mesh_optimize: 0.3,
    messages: [{ role: "user", content: "what is 2+2" }],
  };
  const { request: out } = optimizer.prepare(routine);
  assert.equal(out.output_config?.effort, "medium");

  const nonAnthropic = optimizer.prepare({
    ...structuredClone(routine),
    model: "gpt-5",
  });
  assert.equal(nonAnthropic.request.output_config?.effort, undefined);
});

test("latency:flexible hint marks batch eligible at any dial", () => {
  const optimizer = new MeshOptimizer();
  const { plan } = optimizer.prepare({
    model: "claude-fable-5",
    mesh_optimize: 0.1,
    mesh_hints: { latency: "flexible" },
    messages: [{ role: "user", content: "summarize this corpus" }],
  });
  assert.equal(plan.batchEligible, true);
  assert.ok(plan.leversApplied.includes("batch_eligible"));
});

test("dashboard default applies when request omits the dial", () => {
  const optimizer = new MeshOptimizer({ defaultDial: 0.3 });
  const request = agenticRequest();
  delete request.mesh_optimize;
  const { plan } = optimizer.prepare(request);
  assert.equal(plan.dial, 0.3);
});

test("mesh params are stripped before forwarding to the provider", () => {
  const optimizer = new MeshOptimizer();
  const { request: out } = optimizer.prepare(agenticRequest());
  assert.equal(out.mesh_optimize, undefined);
  assert.equal(out.mesh_hints, undefined);
});

test("mesh provider-prefixed model ids resolve to the bare model", () => {
  const optimizer = new MeshOptimizer();
  const request = agenticRequest();
  request.model = "anthropic/claude-fable-5";
  const { request: out, plan } = optimizer.prepare(request);
  // fable guards fire despite the prefix
  assert.equal(out.temperature, undefined);
  assert.equal(out.top_k, undefined);
  // pruning + cache still apply
  assert.ok(plan.leversApplied.includes("tool_result_pruning"));
  assert.ok(plan.leversApplied.includes("cache_injection"));
});

test("openai-shape system message (messages[0]) gets a breakpoint", () => {
  const optimizer = new MeshOptimizer();
  const { request: out, plan } = optimizer.prepare({
    model: "anthropic/claude-fable-5",
    mesh_optimize: 0.2,
    messages: [
      { role: "system", content: "house rules. ".repeat(800) },
      { role: "user", content: "fix the failing test" },
    ],
  });
  const system = out.messages[0] as any;
  assert.deepEqual(system.cache_control, { type: "ephemeral" });
  assert.ok(plan.leversApplied.includes("cache_injection"));
});
