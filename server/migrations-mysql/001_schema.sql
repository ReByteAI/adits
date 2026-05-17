-- Fresh MySQL/TiDB schema for adits.
-- This is the current target shape after the Postgres migrations in
-- server/migrations have been applied.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(191) PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  rebyte_account_id TEXT,
  rebyte_api_key TEXT,
  rebyte_webhook_id TEXT,
  sandbox_api_key TEXT,
  sandbox_base_url TEXT,
  sandbox_api_key_expires_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name TEXT NOT NULL,
  workspace_id VARCHAR(191) NOT NULL,
  owns_workspace INT NOT NULL DEFAULT 0,
  sandbox_config TEXT,
  vm_id VARCHAR(191),
  file_server_installed_version TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_vm ON projects(vm_id);

CREATE TABLE IF NOT EXISTS files (
  id VARCHAR(191) PRIMARY KEY,
  project_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size BIGINT NOT NULL,
  fs_path TEXT NOT NULL,
  thumb_path TEXT,
  kind VARCHAR(64) NOT NULL DEFAULT 'link',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_files_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_files_user FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(191) PRIMARY KEY,
  workspace_id VARCHAR(191) NOT NULL,
  project_id VARCHAR(191) NOT NULL,
  prompt TEXT NOT NULL,
  title TEXT,
  status VARCHAR(64) NOT NULL DEFAULT 'running',
  url TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3),
  last_synced_at DATETIME(3),
  session_id TEXT,
  session_executor TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS prompts (
  id VARCHAR(191) PRIMARY KEY,
  task_id VARCHAR(191) NOT NULL,
  prompt TEXT NOT NULL,
  executor VARCHAR(64) NOT NULL DEFAULT 'claude',
  status VARCHAR(64) NOT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3),
  form_payload JSON,
  model TEXT,
  CONSTRAINT fk_prompts_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS prompts_task_submitted_idx ON prompts(task_id, submitted_at);
CREATE INDEX IF NOT EXISTS prompts_running_idx ON prompts(id);

CREATE TABLE IF NOT EXISTS frames (
  prompt_id VARCHAR(191) NOT NULL,
  seq BIGINT NOT NULL,
  data JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (prompt_id, seq),
  CONSTRAINT fk_frames_prompt FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
);
