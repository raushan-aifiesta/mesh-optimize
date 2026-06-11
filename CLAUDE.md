# CLAUDE.md - Mesh Optimize (token saver for Mesh API)

## what this is

A gateway-level token optimization layer for Mesh API (meshapi.ai), an LLM gateway by AI Fiesta offering 300+ models through a single OpenAI-compatible endpoint. The feature lets customers set a single dial (0 to 0.95) that controls how aggressively the gateway reduces their token spend, especially for expensive models like claude-fable-5 ($10/$50 per M tokens, 2x Opus 4.8).

Why now: Fable 5 launched ninth june twenty twenty-six. Its Workflow mode (parallel subagents) plus a ~120k token system prompt plus 2x pricing has caused widespread complaints about token burn. Users report draining a $100 Max plan in under 9 minutes. No competitor (OpenRouter, Portkey) has a quality-aware savings dial. This is our wedge.

## product spec

### API surface

OpenAI-compatible. One new request param:

```json
{
  "model": "claude-fable-5",
  "messages": [...],
  "mesh_optimize": 0.6
}
```

- Range 0 to 0.95. Omitted = use the API key's dashboard default. No default set = 0 (off).
- Per-request override always wins over dashboard default.
- Must work on every model we proxy, not just Fable. Levers degrade gracefully when a provider doesn't support a feature (e.g. no effort param on non-Anthropic models).

### response addition

Every optimized response includes:

```json
"mesh_savings": {
  "tokens_saved": 41200,
  "cost_saved_usd": 1.87,
  "levers_applied": ["cache_injection", "effort_downgrade", "tool_result_pruning"],
  "baseline_estimate_method": "pre_optimization_token_count"
}
```

This is the retention weapon. Customers must see savings per call and aggregated in the dashboard.

### lever stack by dial value

Levers are cumulative. Each tier includes everything below it.

| dial | levers | quality risk |
|------|--------|--------------|
| 0 to 0.2 | auto cache_control injection on system prompts and stable prefixes; sane max_tokens defaults per task type (4096 code, 1024 chat) | none |
| 0.2 to 0.4 | effort downgrade to medium on calls classified as routine (Anthropic models only); tool result pruning (truncate or summarize tool outputs from older turns after they've been consumed) | minimal |
| 0.4 to 0.6 | proactive context compaction at ~60% of context window (summarize older turns via a cheap model like Haiku, keep system prompt + last N turns + pinned content verbatim); subagent caps (max 3 parallel, depth 1) when proxying agentic workloads | low, measurable |
| 0.6 to 0.8 | model routing: classified-simple calls rerouted to a cheaper model (e.g. Sonnet 4.6 instead of Fable); relevance-based context filtering (embed conversation chunks, include only chunks relevant to current query); effort low default | moderate, must be disclosed |
| 0.8 to 0.95 | batch API routing where the customer flags latency tolerance; hard compaction; premium models only on explicit per-request flag | high, power-user territory |

### hard rules / gotchas

1. NEVER compact or modify content that is already inside a cache breakpoint. Cached input is 90% off; breaking the cache to save raw tokens is a net loss. Compaction only applies to uncached, dynamic context.
2. Cache injection must be deterministic. Same prefix in = same breakpoints out, or cache hits drop to zero.
3. Model routing (0.6+) must be visible in the response (`levers_applied` + the actual model used in the standard `model` field). Silent model swapping destroys trust.
4. Savings math must be honest. `tokens_saved` = (estimated tokens without optimization) minus (actual tokens billed). Document the estimation method. Never inflate.
5. Opt-out per request: `"mesh_optimize": 0` bypasses everything.
6. Audit log: store what was compacted/pruned per request (hashes + summaries, retention per our data policy) so customers can debug "why did the model forget X".
7. Fable 5 specifics: temperature must be 1.0 or unset, top_k unsupported, thinking cannot be disabled. The optimizer must not send params Fable rejects.

### task classifier (used by effort downgrade + model routing)

Small fast classifier (could be Haiku or a fine-tuned small model) that labels each request: routine / standard / complex / long-horizon-agentic. Inputs: message length, presence of code, tool definitions, conversation depth, explicit keywords. Must run in <100ms or be skipped (fail open = no downgrade).

## build sequence

- Phase 1 (target: 2 to 3 weeks): cache injection + max_tokens defaults + effort routing. Zero quality risk, easy demo. Ship behind a beta flag.
- Phase 2: tool result pruning + proactive compaction + subagent caps.
- Phase 3: model routing + relevance filtering + the full dial UX in dashboard.
- Phase 4: A/B quality mode: run 10% of an opted-in customer's traffic unoptimized, report quality delta alongside savings.

## stack context

- Gateway is OpenAI-compatible proxy. Optimizer = middleware in the request path: intercept request, apply levers per dial, forward to provider, post-process response, attach mesh_savings.
- We already have meshapi-node-sdk (npm). SDK should expose `meshOptimize` as a first-class option and surface `mesh_savings` typed.
- Billing is INR/UPI with GST invoicing; savings reporting in dashboard should show both USD and INR.

## reference docs

- Fable 5 workflows (subagent orchestration): https://code.claude.com/docs/en/workflows
- Prompting Fable 5 (subagent patterns, verifier agents): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5
- Effort param + cost control: https://platform.claude.com/docs/en/build-with-claude/effort
- Anthropic prompt caching docs (cache_control, 90% input discount)
- Anthropic batch API docs (50% discount)

## decisions already made (do not relitigate)

1. Single dial, not a config object of 15 toggles. Simplicity is the product.
2. Lever stack mapping above is v1. Tune thresholds with data, don't redesign tiers.
3. mesh_savings in every response, non-negotiable.
4. Honest UX: past dial 0.5 the dashboard must show estimated quality impact next to savings, not just the savings number.
5. Launch angle: "cut your Fable 5 bill 60%". Build-in-public series will cover this (Raushan runs a daily X series, ~day 53).
6. Dial vs hints: the dial is the only preference knob (how much quality risk to accept). `mesh_hints` carries workload facts the gateway cannot infer (`latency: "flexible"` unlocks batch routing at any dial, `session_id` enables cross-turn cache placement). Every future lever gets sorted into one of these two buckets; never add per-lever toggles.

## open questions for claude code to help resolve

1. Compaction summarizer: Haiku via our own gateway vs provider-side? Cost vs latency tradeoff.
2. Where does conversation state live for compaction? Gateway is currently stateless per request; compaction of multi-turn history requires either client-sent full history (we compact in-flight, stateless) or server-side session store. Leaning stateless in-flight for v1.
3. Classifier: heuristics-only v1 (regex + length + tool presence) vs small model from day one?
4. How to estimate `tokens_saved` baseline cheaply without double-tokenizing every request?
5. Subagent caps: can we even detect/control subagent fan-out when proxying, or is this only enforceable for Claude Code style clients that route each subagent call through us?

## writing style (for any docs, copy, or commit messages)

- no em dashes, ever
- no AI vocabulary: delve, robust, seamless, leverage, harness, elevate
- specifics over adjectives, numbers over vague claims
- dates written out in words: ninth june twenty twenty-six
- casual founder register, lowercase fine in marketing copy, normal case in technical docs
