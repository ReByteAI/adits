-- Attach the `ask-design-questions` skill's structured payload to the
-- prompt row that emitted it. The runner writes this column inside the
-- same atomic guard that sets `terminal_emitted_at` (see
-- emitTerminal in server/backend/local/task-runner.ts). NULL when the
-- turn didn't emit a form — which is the vast majority of turns.

ALTER TABLE prompts
  ADD COLUMN IF NOT EXISTS form_payload JSONB;
