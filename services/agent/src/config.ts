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
  /** Persona/system block is identical every turn — cache it (bills ~10% of input rate). */
  contextCaching: true,
} as const;

/** GYM-56: kill switch — flip AGENT_DISABLED=1 to stop all LLM traffic in minutes. */
export function agentDisabled(): boolean {
  return process.env.AGENT_DISABLED === "1";
}
