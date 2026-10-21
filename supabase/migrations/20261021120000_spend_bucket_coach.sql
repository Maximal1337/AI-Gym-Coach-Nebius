-- My Coach on Token Factory (DOR-135): the hackathon app's plan generation
-- and in-workout coach move from the live app's agent service (Gemini
-- through OpenRouter) to Nemotron, on a Token Factory key of their own. Their
-- spend gets its own bucket, 'coach', under its own daily ceiling
-- (ASSISTANT_SPEND_CEILING_CENTS_COACH in _shared/assistant.ts), next to the
-- assistant's 'prod' and 'dev' and the nightly job's 'memory' (D-34).
-- Additive: the existing buckets and their rows are untouched.
alter table public.assistant_spend drop constraint assistant_spend_bucket_check;
alter table public.assistant_spend
  add constraint assistant_spend_bucket_check check (bucket in ('prod', 'dev', 'memory', 'coach'));
