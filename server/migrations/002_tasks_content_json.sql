-- Local-mode task transcripts live in-process (no Rebyte `/content` proxy).
-- Hosted mode ignores this column. Nullable + additive so either mode can
-- run against the same schema.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS content_json JSONB;
