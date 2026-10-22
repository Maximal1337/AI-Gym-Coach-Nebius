// services/agent builds its model as ChatOpenRouter from "@langchain/openrouter".
// In the hackathon app's coach functions that name maps here (session-start's
// and coach-turn's deno.json), so the agent's code runs unchanged with
// Nemotron on Token Factory answering (DOR-135).
import { ChatOpenAI } from "npm:@langchain/openai@1.5.5";
import { coachModel } from "../_shared/coach.ts";
import { TOKEN_FACTORY_BASE_URL } from "../_shared/token-factory.ts";

/** Reasoning tokens count against max_tokens: the agent's 800 would cut a turn that thinks. */
const MIN_MAX_TOKENS = 2000;

export class ChatOpenRouter extends ChatOpenAI {
  constructor(opts: { model?: string; apiKey?: string; maxTokens?: number; temperature?: number; siteName?: string }) {
    super({
      model: coachModel(),
      apiKey: opts.apiKey,
      maxTokens: Math.max(opts.maxTokens ?? 0, MIN_MAX_TOKENS),
      temperature: opts.temperature,
      configuration: { baseURL: TOKEN_FACTORY_BASE_URL },
      // Thinking off for a reply on its own: 1.0 to 1.8 s on 2026-10-22,
      // against 7.5 to 15 s with `low`.
      modelKwargs: { reasoning_effort: "none" },
    });
  }

  // A turn with tools (logging sets, switching or substituting an exercise)
  // thinks a little: with `low`, every set was logged right in Hebrew and
  // English. The agent builds a new model for each call.
  override bindTools(
    tools: Parameters<ChatOpenAI["bindTools"]>[0],
    kwargs?: Parameters<ChatOpenAI["bindTools"]>[1],
  ): ReturnType<ChatOpenAI["bindTools"]> {
    this.modelKwargs = { ...this.modelKwargs, reasoning_effort: "low" };
    return super.bindTools(tools, kwargs);
  }
}
