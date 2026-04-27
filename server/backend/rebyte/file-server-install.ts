/**
 * Install the :8080 static file-server on a project's VM, once per project.
 *
 * Background: every Adits project has a user-addressable file-tree URL
 * (`<root>/<path>`), where the hosted-mode root is `https://8080-<vmId>
 * .<env>.rebyte.app`.
 *
 * This module owns the server side for hosted mode: write a systemd unit
 * that runs `http-server` against `/code`, enable-and-start it, and stamp
 * the project row so the install doesn't run twice. systemd's
 * `Restart=always` handles auto-restart across VM pause/resume forever
 * after — we never need to touch this VM for file-server reasons again.
 *
 * Local mode (`ADITS_BACKEND=local`) has its own file server (Hono's
 * `serveStatic` on the same process) and never reaches this code.
 */

import type { Sandbox } from 'rebyte-sandbox'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from '../../db.js'

/** Bump to re-install the systemd unit + re-upload the binary on every
 *  project's VM. Used as both a cheap DB-gated skip token and the key
 *  the slow path writes back after a successful `systemctl restart`.
 *
 *  v1 (retired): `npx http-server` serving /code. No injection, no
 *                bridge support.
 *  v2 (retired): Adits Go binary at /usr/local/bin/adits-file-server
 *                with HTML <script> injection + /_adits/inject.js
 *                bridge route.
 *  v3 (retired): same binary, updated inject script adding present-
 *                mode handlers, `#speaker-notes` parsing + observer,
 *                and the `{slideIndexChanged}` passthrough that the
 *                presentation lane relies on.
 *  v4 (current): binary moved to `/home/user/.local/bin/adits-file-server`
 *                (user-writable, no sudo+mv from /tmp hop). Unit file
 *                ExecStart updated to the new path. Systemd still runs
 *                the service as root (no `User=` directive) so it can
 *                read /code regardless of ownership.
 */
const INSTALL_VERSION = 'v4'

const UNIT_PATH = '/etc/systemd/system/adits-file-server.service'
// Binary lives under the default sandbox user's home so `sbx.files.write`
// can drop it in place — no /tmp hop, no sudo mv, no explicit chmod
// under root. The VM template sets DEFAULT_WORKDIR=/home/user, so this
// path is stable.
const BIN_PATH = '/home/user/.local/bin/adits-file-server'
const BIN_DIR = '/home/user/.local/bin'

/** Systemd unit for the Go binary. Adits uploads the binary once on
 *  install, then systemd keeps it alive across VM pause/resume. */
const UNIT_FILE = `[Unit]
Description=Adits file server
After=network.target

[Service]
Type=simple
ExecStart=${BIN_PATH} --root /code --port 8080
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
`

/** Path to the committed Linux/amd64 binary, relative to this module's
 *  compiled location. In dev (`tsx`) `import.meta.url` is the .ts file;
 *  in prod it's the built JS. Either way the `server/` tree shape is
 *  identical, so `../../vm-bin/...` resolves from
 *  `server/backend/rebyte/file-server-install.ts`. */
const __dirname = dirname(fileURLToPath(import.meta.url))
const BINARY_ON_DISK = join(__dirname, '..', '..', 'vm-bin', 'adits-file-server-linux-amd64')

/** Install the :8080 file-server on this project's VM if it hasn't
 *  been done at the current `INSTALL_VERSION`. Fast path is a ~1 ms
 *  DB lookup; slow path writes the unit, reloads, enables, restarts,
 *  and stamps the column.
 *
 *  Concurrency: `connectProjectSandbox` can race with itself across two
 *  concurrent first-hit requests on the same project. The DB gate is a
 *  plain SELECT-then-UPDATE, so concurrent callers CAN both run the
 *  slow path. All three systemctl operations are idempotent
 *  (daemon-reload, enable, restart), and the final UPDATE stamps the
 *  same version string, so the end state converges correctly. We accept
 *  the rare duplicate-install cost rather than add a per-project
 *  advisory lock that would hold a pg connection across the seconds-
 *  long systemctl RPC.
 *
 *  Failure handling: the stamp only runs AFTER `systemctl restart`
 *  succeeds, so any error mid-install leaves the row NULL and the
 *  next `connectProjectSandbox` tick retries. */
export async function ensureProjectFileServerInstalled(
  userId: string,
  projectId: string,
  sbx: Sandbox,
): Promise<void> {
  const row = await db.first<{ v: string | null }>(
    `SELECT file_server_installed_version AS v
       FROM projects
      WHERE id = $1 AND user_id = $2`,
    [projectId, userId],
  )
  if (row?.v === INSTALL_VERSION) return

  console.log(`[file-server] installing ${INSTALL_VERSION} on project ${projectId}`)

  // Wrap every sandbox operation so the exception carries enough
  // context to debug. Default SDK errors come through as empty
  // `.message` strings, which 503'd the client without any signal.
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      const e = err as { message?: string; stdout?: string; stderr?: string; exitCode?: number }
      const parts = [
        `[file-server:${label}] failed`,
        e.exitCode !== undefined ? `exit=${e.exitCode}` : '',
        e.stderr ? `stderr=${e.stderr.trim()}` : '',
        e.stdout ? `stdout=${e.stdout.trim()}` : '',
        e.message ? `msg=${e.message}` : '',
      ].filter(Boolean).join(' ')
      console.error(parts)
      throw new Error(parts)
    }
  }

  // Binary: write into ~/.local/bin then sudo-chmod. `sbx.files.write`
  // doesn't always land the file as the sandbox user (template detail),
  // so a plain chmod can hit "Operation not permitted". sudo is already
  // passwordless (template-start.sh uses it for `systemctl start ccc`).
  //
  // Unit file: /etc/systemd/system/ is root-only, so we stage in /tmp
  // and sudo-mv.
  const TMP_UNIT = '/tmp/adits-file-server.service'

  const binaryBuf = await readFile(BINARY_ON_DISK)
  const binaryBytes = new Uint8Array(binaryBuf.byteLength)
  binaryBytes.set(binaryBuf)
  await run('mkdir-bin-dir', () => sbx.commands.run(`sudo mkdir -p ${BIN_DIR}`))
  await run('upload-bin', () => sbx.files.write(BIN_PATH, binaryBytes.buffer))
  await run('chmod-bin', () => sbx.commands.run(`sudo chmod 0755 ${BIN_PATH}`))

  await run('upload-unit', () => sbx.files.write(TMP_UNIT, UNIT_FILE))
  await run('mv-unit', () => sbx.commands.run(`sudo mv ${TMP_UNIT} ${UNIT_PATH}`))

  await run('daemon-reload', () => sbx.commands.run('sudo systemctl daemon-reload'))
  await run('enable', () => sbx.commands.run('sudo systemctl enable adits-file-server'))
  await run('restart', () => sbx.commands.run('sudo systemctl restart adits-file-server'))

  // Stamp last. user_id is in the WHERE so a crafted projectId from
  // another user can't poison this row.
  await db.run(
    `UPDATE projects
        SET file_server_installed_version = $1
      WHERE id = $2 AND user_id = $3`,
    [INSTALL_VERSION, projectId, userId],
  )
}
