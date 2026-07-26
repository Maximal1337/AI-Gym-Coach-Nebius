// Temporary smoke test — not part of the build.
import { composeWithLlm } from "./llm.js";

const r = await composeWithLlm(
  "You are a helpful coach. Reply in Hebrew.",
  "Say hello in one short sentence.",
).catch((e) => {
  console.error("LLM ERROR:", e?.message ?? e);
  process.exit(1);
});
console.log(JSON.stringify(r, null, 1));
