/**
 * Central LLM + cost-safety configuration.
 * One choke point: nothing outside this service ever talks to the model,
 * so caps and provider swaps live here and nowhere else.
 */

export const llmConfig = {
  provider: "openrouter" as const,
  // Routed through OpenRouter rather than calling Google directly — same
  // model, same $0.25/M in / $1.50/M out pricing, but prepaid credit-balance
  // billing instead of GCP's bill-in-arrears model (requests just fail once
  // the balance hits zero, no way to exceed what's been funded). Model
  // itself deliberately unchanged: swapping providers risked no quality
  // regression, swapping models risked one (esp. Hebrew/Arabic coaching
  // tone), so only the billing relationship moved, not the LLM.
  // 2.5-flash-lite is closed to new API users (404s); 3.1-flash-lite is the
  // cheapest Flash-Lite currently open.
  model: "google/gemini-3.1-flash-lite",
  /** GYM-51: no single call can generate a runaway-expensive response. */
  maxOutputTokens: 800,
  temperature: 0.4,
  // Prompt caching: Gemini 2.5 models apply implicit caching automatically
  // to repeated prefixes (our persona/system block). Explicit CachedContent
  // is a later optimization if billing shows implicit isn't catching it.
} as const;

/** GYM-56: kill switch — flip AGENT_DISABLED=1 to stop all LLM traffic in minutes. */
export function agentDisabled(): boolean {
  return process.env.AGENT_DISABLED === "1";
}
