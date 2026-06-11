import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/classifier.js";

test("short question with no code is routine", () => {
  assert.equal(
    classify({
      model: "claude-fable-5",
      messages: [{ role: "user", content: "what is the capital of france" }],
    }),
    "routine",
  );
});

test("code content is complex", () => {
  assert.equal(
    classify({
      model: "claude-fable-5",
      messages: [
        { role: "user", content: "```ts\nfunction a() {}\n``` refactor this" },
      ],
    }),
    "complex",
  );
});

test("tools plus depth is agentic", () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn ${i}`,
  }));
  assert.equal(
    classify({ model: "claude-fable-5", messages, tools: [{ name: "bash" }] }),
    "agentic",
  );
});

test("long prose without code is standard", () => {
  assert.equal(
    classify({
      model: "claude-fable-5",
      messages: [{ role: "user", content: "tell me about ".repeat(100) }],
    }),
    "standard",
  );
});
