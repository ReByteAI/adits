-- Per-task executor session id for conversation continuation in local mode.
-- claude → pre-assigned UUID (stashed before spawn; --session-id / --resume)
-- gemini → sniffed from first `init` frame (-o stream-json; --resume)
-- codex  → sniffed from first `thread.started` frame (--json; `codex exec resume`)
-- opencode → sniffed from first event's sessionID (--format json; -s)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS session_id TEXT;
-- session_id is executor-specific (claude UUID != gemini UUID != codex thread id).
-- We only resume when the follow-up's executor matches the one that wrote the id;
-- otherwise we start fresh and overwrite both columns.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS session_executor TEXT;
