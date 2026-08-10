---
name: agent-prompts
description: Guidance for editing the LLM prompt assembly in services/agent/src/prompt.ts (system prompt, formatting rules, language directive) and related agent behavior. Use whenever changing what instructions get sent to the coaching model, or diagnosing a case where the model ignored/misread an instruction (wrong language, wrong formatting, tone drift).
---

# Editing the coaching agent's prompts

`services/agent/src/prompt.ts` assembles the system prompt sent on every
coaching turn. The model behind it (`services/agent/src/config.ts`) is
`google/gemini-3.1-flash-lite` — chosen deliberately for cost, per the
comment in `config.ts`. That tradeoff means instructions need to be more
explicit and more redundant than they would for a larger model; terse or
coded instructions are more likely to be misread.

## The concrete lesson (language-drift bug)

The system prompt used to pass the client's raw ISO 639-1 language code
straight through: `Reply exclusively in this language: he.` A bare two-letter
code is ambiguous — easy to misparse as an abbreviation or, in one observed
production case, ignored entirely (a Hebrew-language user got a reply in
Finnish). The fix was a `LANGUAGE_NAMES` map (`en`→`English`, `he`→`Hebrew`,
`ar`→`Arabic`) so the prompt spells out `Reply exclusively in Hebrew.` plus
an explicit "never switch mid-reply" clause, falling back to the raw code
for any future unmapped value.

**General rule this generalizes to**: any value interpolated into the
prompt that carries meaning by convention rather than literally (codes,
enums, abbreviations) should be translated to an unambiguous natural-language
phrase before interpolation, not passed through raw — especially for
non-negotiable constraints (language, safety rules, formatting).

## Structure to preserve

`buildSystemPrompt` deliberately layers:
1. `SAFETY_RULES` — server-owned, never influenced by user persona text.
2. `FORMATTING_GUIDE` — the client only renders `**bold**` and emoji, and
   splits bubbles on blank lines; this is a real signal the client parses
   (`splitCoachReply` in `apps/mobile/src/lib/messageChunks.ts`), not just a
   style suggestion — don't loosen this without checking that function.
3. Persona fields (name, tone, accountability, language), explicitly framed
   as *subordinate* to the rules above.
4. `personaFreeform` appended last, and only if present.

Keep new instructions in the layer matching their authority — don't add
user-influenceable content before the non-negotiable rules.

## Verifying a prompt change

- `cd services/agent && npx tsc --noEmit -p .` and `npm test`
  (`src/*.test.ts`, plain `node:test`) — no existing test asserts on exact
  prompt string content, so a wording change won't be caught by tests; read
  the diff carefully instead.
- There is no way to run the actual model in this sandbox — changes here
  ship on trust in the wording plus the next real report, not a
  reproduction. Say so explicitly rather than claiming verified behavior.
- Deploy via the `ship-change` skill's `services/agent/*` row
  (`fly deploy --config services/agent/fly.toml --dockerfile
  services/agent/Dockerfile`, run from repo root) once the user approves.
