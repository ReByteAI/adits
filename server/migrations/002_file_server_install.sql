-- Per-project marker that records the INSTALL_VERSION of the in-VM
-- file server (systemd unit). NULL = needs install. Stamped at the end
-- of ensureProjectFileServerInstalled, AFTER `systemctl daemon-reload`
-- / `enable` / `restart` all succeed — so a failure anywhere in the
-- sequence leaves the row NULL and the next connectProjectSandbox
-- tick retries.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS file_server_installed_version TEXT;
