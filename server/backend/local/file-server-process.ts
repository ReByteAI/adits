/**
 * Spawn the `adits-file-server` Go binary as a child of the Node process.
 *
 * Binary selection: same compiled program as hosted mode, one per
 * (platform, arch). If no build exists for the host we fail fast — no
 * graceful degradation. See `server/vm-bin/`.
 *
 * Lifecycle: started once at server boot (local mode only), dies with the
 * parent via SIGTERM. If the child exits unexpectedly, we log and let the
 * parent keep running — the user can restart or file a bug.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { env } from '../../env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BIN_DIR = join(__dirname, '..', '..', 'vm-bin')

function binaryPath(): string {
  const goos = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null
  const goarch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null
  if (!goos || !goarch) {
    throw new Error(`adits-file-server: unsupported host ${process.platform}/${process.arch}`)
  }
  return join(BIN_DIR, `adits-file-server-${goos}-${goarch}`)
}

/** Single-attempt health probe. Used by `startLocalFileServer`'s boot
 *  loop only — request-path probing went away with the
 *  `FileServer.ensureReady` abstraction. */
async function probeHealth(timeoutMs: number): Promise<boolean> {
  const url = `http://127.0.0.1:${env.FILE_SERVER_PORT}/_adits/health`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** Boot the local file-server. Resolves once the child has responded to
 *  `/_adits/health` — not just spawned — so callers get a real guarantee
 *  that the URL is live. Throws if the child exits early or never answers
 *  (port collision, missing binary stamp, whatever). */
export async function startLocalFileServer(): Promise<void> {
  const bin = binaryPath()
  await access(bin).catch(() => {
    throw new Error(
      `adits-file-server binary not found at ${bin}. Build it from server/vm-bin/adits-file-server/ with GOOS=${process.platform} GOARCH=${process.arch === 'x64' ? 'amd64' : process.arch} go build.`,
    )
  })

  const root = join(env.ADITS_DATA_DIR, 'projects')
  const child = spawn(bin, ['--root', root, '--port', String(env.FILE_SERVER_PORT), '--host', '127.0.0.1'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: false,
  })

  let earlyExit: Error | null = null
  child.on('exit', (code, signal) => {
    const msg = `adits-file-server exited: code=${code} signal=${signal}`
    earlyExit = new Error(msg)
    console.warn(`[file-server] ${msg}`)
  })

  // Die with the parent: SIGTERM on normal shutdown. Node forwards
  // SIGINT/SIGTERM automatically when stdio isn't detached, but we
  // belt-and-suspenders for safety. SIGKILL on the parent cannot be
  // handled — the OS takes care of descendants via the group.
  const forward = (sig: NodeJS.Signals) => () => { child.kill(sig) }
  process.once('SIGINT', forward('SIGINT'))
  process.once('SIGTERM', forward('SIGTERM'))
  process.once('exit', () => { child.kill('SIGTERM') })

  // Poll /_adits/health until it answers or the child dies. ~3s budget;
  // real boot is <100 ms in practice.
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (earlyExit) throw earlyExit
    if (await probeHealth(200)) {
      const rootUrl = `http://127.0.0.1:${env.FILE_SERVER_PORT}`
      console.log(`[file-server] ready at ${rootUrl}, serving ${root}`)
      return
    }
    await new Promise(r => setTimeout(r, 50))
  }
  // Last chance: did we miss an exit event?
  if (earlyExit) throw earlyExit
  child.kill('SIGTERM')
  throw new Error(`adits-file-server failed to answer /_adits/health on port ${env.FILE_SERVER_PORT} within 3s`)
}
