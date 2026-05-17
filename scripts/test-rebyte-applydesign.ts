/**
 * Standalone integration test for `rebyteFileStore.applyDesignSystem`.
 * Bypasses the Hono server, the Postgres DB, Clerk auth, and the project
 * row entirely — provisions a fresh Rebyte agent-computer with the
 * partner API key, reproduces the zip+upload+exec flow from
 * `server/backend/rebyte/file-store.ts` inline, reads the destination
 * files back to verify, then deletes the agent-computer in a `finally`
 * so the VM can never leak.
 *
 * **WARNING — this hits production Rebyte (api.rebyte.ai/v1).** A
 * successful or failed run both billed the partner account for the
 * provisioning + the VM minutes between create and delete (typically
 * 30–90s). The cleanup `finally` is best-effort; if cleanup itself
 * throws, the VM id is printed loudly so it can be deleted manually
 * via the Rebyte console.
 *
 * Usage (from /code/adits):
 *   node \
 *     --env-file=/code/adits-deploy/.env.prod \
 *     --experimental-strip-types \
 *     scripts/test-rebyte-applydesign.ts [design-system-id]
 *
 * Default DS id is `linear-app`. Pass any registered id as argv[2].
 */

import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { Sandbox } from 'rebyte-sandbox'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DESIGN_SYSTEMS_DIR = resolve(
  __dirname,
  '..',
  'server',
  'backend',
  'local',
  'design-systems',
)

const DS_ID = process.argv[2] ?? 'linear-app'
const VM_PROJECT_ROOT = '/code'

const REBYTE_API_URL = required('REBYTE_API_URL')
const REBYTE_API_KEY = required('REBYTE_API_KEY')

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

interface AgentComputer {
  id: string
  status: string
  sandboxId: string
  sandboxBaseUrl: string
  sandboxApiKey: string
}

async function rebyteJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${REBYTE_API_URL}${path}`, {
    ...init,
    headers: {
      'API_KEY': REBYTE_API_KEY,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${res.statusText}\n${text}`)
  }
  return res.json() as Promise<T>
}

async function provisionVm(name: string): Promise<AgentComputer> {
  console.log(`[step 1/6] POST /agent-computers (name="${name}")`)
  const created = await rebyteJSON<AgentComputer>('/agent-computers', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  console.log(`           → id=${created.id} status=${created.status}`)
  if (created.sandboxId) return created

  console.log(`[step 2/6] polling /agent-computers/${created.id} for sandboxId…`)
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const fresh = await rebyteJSON<AgentComputer>(`/agent-computers/${created.id}`)
    if (fresh.sandboxId) {
      console.log(`           → ready after ${(i + 1) * 2}s (sandboxId=${fresh.sandboxId})`)
      return { ...created, ...fresh }
    }
  }
  throw new Error(`agent-computer ${created.id} did not finish provisioning within 60s`)
}

async function deleteVm(id: string): Promise<void> {
  console.log(`[cleanup ] DELETE /agent-computers/${id}`)
  try {
    await rebyteJSON(`/agent-computers/${id}`, { method: 'DELETE' })
    console.log(`           → cleanup OK`)
  } catch (err) {
    console.error(`           → CLEANUP FAILED for VM ${id}: ${(err as Error).message}`)
    console.error(`           → Manual delete required: ${REBYTE_API_URL}/agent-computers/${id}`)
  }
}

async function buildZip(): Promise<Uint8Array> {
  const srcDir = join(DESIGN_SYSTEMS_DIR, DS_ID)
  const impeccableSrc = join(srcDir, 'impeccable.md')
  const impeccableStat = await stat(impeccableSrc).catch(() => null)
  if (!impeccableStat?.isFile()) {
    throw new Error(`missing source ${impeccableSrc}`)
  }
  const zip = new JSZip()
  zip.file('impeccable.md', await readFile(impeccableSrc))
  const assetsDir = join(srcDir, 'assets')
  const assetsStat = await stat(assetsDir).catch(() => null)
  if (assetsStat?.isDirectory()) {
    await addDirToZip(zip.folder('assets')!, assetsDir)
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function addDirToZip(folder: JSZip, hostDir: string): Promise<void> {
  const entries = await readdir(hostDir, { withFileTypes: true })
  for (const entry of entries) {
    const childHostPath = join(hostDir, entry.name)
    if (entry.isDirectory()) {
      const sub = folder.folder(entry.name)
      if (sub) await addDirToZip(sub, childHostPath)
    } else if (entry.isFile()) {
      folder.file(entry.name, await readFile(childHostPath))
    }
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const vmName = `adits-ds-test-${stamp}`
  console.log(`Test target: design system "${DS_ID}"`)
  console.log(`API: ${REBYTE_API_URL}`)
  console.log('')

  const ac = await provisionVm(vmName)
  const ACID = ac.id
  console.log(`\n!!! VM id: ${ACID}  (delete manually if cleanup fails) !!!\n`)

  try {
    console.log(`[step 3/6] Sandbox.connect(${ac.sandboxId})`)
    const domain = new URL(ac.sandboxBaseUrl).hostname
    const sbx = await Sandbox.connect(ac.sandboxId, {
      apiUrl: ac.sandboxBaseUrl,
      apiKey: ac.sandboxApiKey,
      domain,
      requestTimeoutMs: 60_000,
    })
    console.log(`           → connected`)

    console.log(`[step 4/6] zip + upload to /tmp/adits-ds-${DS_ID}.zip`)
    const zipBytes = await buildZip()
    console.log(`           → zip size: ${zipBytes.byteLength} bytes`)
    const tmpZip = `/tmp/adits-ds-${DS_ID}.zip`
    const tmpDir = `/tmp/adits-ds-${DS_ID}`
    const dstAssets = `${VM_PROJECT_ROOT}/.skills/design-systems/${DS_ID}`
    const ab = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength,
    ) as ArrayBuffer
    await sbx.files.write(tmpZip, ab)

    console.log(`[step 5/6] sbx.commands.run(unzip + cp + cleanup)`)
    const cmd = [
      'set -e',
      `rm -rf ${tmpDir}`,
      `mkdir -p ${tmpDir} ${dstAssets} ${VM_PROJECT_ROOT}`,
      `unzip -o ${tmpZip} -d ${tmpDir}`,
      `cp ${tmpDir}/impeccable.md ${VM_PROJECT_ROOT}/.impeccable.md`,
      `if [ -d ${tmpDir}/assets ]; then cp -R ${tmpDir}/assets/. ${dstAssets}/; fi`,
      `rm -rf ${tmpZip} ${tmpDir}`,
    ].join(' && ')
    const result = await sbx.commands.run(cmd)
    console.log(`           → exit=${result.exitCode}`)
    if (result.stdout) console.log(`           stdout: ${result.stdout.trim().slice(0, 400)}`)
    if (result.stderr) console.log(`           stderr: ${result.stderr.trim().slice(0, 400)}`)
    if (result.exitCode !== 0) throw new Error(`unzip command exited non-zero`)

    console.log(`[step 6/6] read back /code/.impeccable.md to verify`)
    const back = await sbx.files.read(`${VM_PROJECT_ROOT}/.impeccable.md`, { format: 'text' })
    const head = back.trim().split('\n').slice(0, 8).join('\n')
    console.log('-----')
    console.log(head)
    console.log('-----')
    if (!back.startsWith('## Design Context')) {
      throw new Error(`/code/.impeccable.md did not start with "## Design Context"`)
    }
    console.log(`\n✓ PASS — applyDesignSystem("${DS_ID}") landed correctly in VM ${ACID}`)
  } finally {
    console.log('')
    await deleteVm(ACID)
  }
}

main().catch(err => {
  console.error('\n✗ FAIL')
  console.error(err)
  process.exit(1)
})
