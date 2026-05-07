-- Persist the selected model per prompt so the chat composer can seed its
-- picker from an existing thread's latest turn instead of falling back to a
-- global default.

ALTER TABLE prompts
  ADD COLUMN IF NOT EXISTS model TEXT;
