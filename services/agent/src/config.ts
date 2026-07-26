/**
 * Central LLM + cost-safety configuration.
 * One choke point: nothing outside this service ever talks to the model,
 * so caps and provider swaps live here and nowhere else.
 */

export const llmConfig = {
  provider: "google" as const,
  model: "gemini-2.5-flash-lite",
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
