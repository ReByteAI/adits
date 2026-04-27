-- Promote prompts from a JSONB blob inside tasks.content_json into their
-- own table so the atomic terminal guard has somewhere to live.
--
-- Dev-mode wipe: DELETE before the schema change keeps us from dragging
-- stale content_json state into the new world.

DELETE FROM tasks;

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  executor TEXT NOT NULL DEFAULT 'claude',
  status TEXT NOT NULL,                     -- 'running' | 'completed' | 'failed' | 'canceled'
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  terminal_emitted_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Terminal snapshot of the prompt's frames. NULL while running (live frames
  -- live in the in-memory StreamStore); populated inside the same PG txn
  -- that sets terminal_emitted_at.
  frames_json JSONB
);

CREATE INDEX IF NOT EXISTS prompts_task_submitted_idx ON prompts (task_id, submitted_at);
CREATE INDEX IF NOT EXISTS prompts_running_idx ON prompts (id) WHERE status = 'running';

ALTER TABLE tasks DROP COLUMN IF EXISTS content_json;
