-- Replace the streamStore + atomic-guard machinery with a plain frames
-- table:
--
--   producer (local stdout / rebyte upstream pipe)  →  INSERT INTO frames
--   reader   (single SSE per running prompt)        →  SELECT frames WHERE seq > $cursor
--
-- prompts.terminal_emitted_at + prompts.frames_json + task_events table all
-- go away — they were the atomic-guard model the simplified flow doesn't
-- need. Status transitions on prompts/tasks are plain UPDATEs now.
--
-- Dev-mode wipe: nuke the tables that hold transient task state so we don't
-- carry weird half-typed rows from the old shape across the schema move.

DELETE FROM tasks;

CREATE TABLE IF NOT EXISTS frames (
  prompt_id  TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  seq        BIGINT NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (prompt_id, seq)
);

DROP TABLE IF EXISTS task_events;

ALTER TABLE prompts DROP COLUMN IF EXISTS terminal_emitted_at;
ALTER TABLE prompts DROP COLUMN IF EXISTS frames_json;
ALTER TABLE prompts DROP COLUMN IF EXISTS last_synced_at;
