import { MeshOptimizer, attachSavings } from "./src/index.js";

const optimizer = new MeshOptimizer({ defaultDial: 0.2 });

const { request, plan } = optimizer.prepare({
  model: "claude-fable-5",
  mesh_optimize: 0.3,
  system: "You are a coding agent. ".repeat(600),
  messages: [
    { role: "user", content: "fix the failing test" },
    { role: "assistant", content: "Looking." },
    { role: "tool", content: "x".repeat(5000) },
    { role: "assistant", content: "Patched." },
    { role: "user", content: "status?" },
  ],
  temperature: 0.7,
});

console.log("classification:", plan.classification);
console.log("levers applied:", plan.leversApplied);
console.log("system is now cached:", Array.isArray(request.system));
console.log("estimated tokens pruned:", plan.estimatedTokensRemoved);
console.log("temperature stripped for fable:", request.temperature === undefined);

// simulate a provider response with a cache hit
const enriched = attachSavings(plan, {
  usage: { input_tokens: 500, cache_read_input_tokens: 100_000, output_tokens: 800 },
});
console.log("\nmesh_savings receipt:");
console.log(enriched.mesh_savings);
