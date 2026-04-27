-- Separate the "VM id" concept from the "event-routing address."
-- Before this migration, `projects.workspace_id` served both roles:
--   Role A (VM id)       — used by rebyte-only code to call /agent-computers/:id,
--                          connect via the Sandbox SDK, build file-server URLs.
--   Role B (SSE routing) — used to scope task_events to a project subtree.
--
-- In local mode, Role A is inapplicable (there is no VM), which forced an
-- identity hack: `workspace_id = projectId`. Splitting Role A into its own
-- nullable column lets local write NULL honestly, and lets any "do we have
-- a VM?" branch read `vm_id IS NOT NULL` instead of `ADITS_BACKEND === 'local'`.
--
-- `workspace_id` stays as-is for now — task_events and SSE still route on it.
-- A future migration can drop it in favor of routing by project_id if we
-- ever want to collapse the two addressing layers. In rebyte rows, vm_id
-- and workspace_id hold the same value (the agent-computer id) until then.
--
-- INVARIANT: on rebyte, vm_id MUST be non-null. It's the handle for every
-- rebyte API call (/agent-computers/:id, Sandbox SDK, file-server URL).
-- The rebyte FileStore.createProject enforces this — it provisions the VM
-- before inserting the project row, and fails loud if the agent-computer
-- response has no id. A NULL vm_id on a rebyte row means someone short-
-- circuited createProject and the project is unusable.

ALTER TABLE projects ADD COLUMN vm_id TEXT;

-- Backfill: rebyte rows carry the agent-computer id in workspace_id today.
-- Detect them by presence of sandbox_config (NULL in local, set in rebyte).
UPDATE projects SET vm_id = workspace_id WHERE sandbox_config IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_vm ON projects(vm_id);
