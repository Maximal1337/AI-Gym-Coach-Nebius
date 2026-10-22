import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { llmApiKey, setLlmApiKey } from "./config.ts";

const saved = process.env.OPENROUTER_API_KEY;
afterEach(() => {
  setLlmApiKey(undefined);
  if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = saved;
});

test("llmApiKey: OPENROUTER_API_KEY unless a host hands one over", () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  assert.equal(llmApiKey(), "or-key");
  setLlmApiKey("tf-key");
  assert.equal(llmApiKey(), "tf-key");
  setLlmApiKey(undefined);
  assert.equal(llmApiKey(), "or-key");
});

test("llmApiKey: null means no key at all, so the deterministic replies answer", () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  setLlmApiKey(null);
  assert.equal(llmApiKey(), undefined);
});
