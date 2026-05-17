import { Sandbox } from 'rebyte-sandbox'

type SandboxApiKeyResponse = {
  apiKey: string
  baseUrl: string
}

const partnerApiKey = process.env.REBYTE_API_KEY
const rebyteApiUrl = process.env.REBYTE_API_URL ?? 'https://api.rebyte.ai/v1'
const directSandboxApiKey = process.env.SANDBOX_API_KEY
const directSandboxApiUrl = process.env.SANDBOX_API_URL

const iterations = Number(process.env.ITERATIONS ?? process.argv[2] ?? 20)
const mode = process.env.MODE ?? 'agent-computer'
const template = process.env.SANDBOX_TEMPLATE ?? 'base'
const command = process.env.COMMAND ?? 'sudo mkdir -p /home/user/.local/bin'
const pauseMs = Number(process.env.PAUSE_MS ?? 0)
const rebyteUserApiKey = process.env.REBYTE_USER_API_KEY ?? partnerApiKey

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function message(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message
  return String(err)
}

function classify(err: unknown): string {
  const msg = message(err).toLowerCase()
  if (msg.includes('unimplemented') && msg.includes('404')) return 'unimplemented_404'
  if (msg.includes('http 404')) return 'http_404'
  if (msg.includes('timeout')) return 'timeout'
  if (msg.includes('sandbox not found')) return 'sandbox_not_found'
  return 'other'
}

async function rebyteJSON<T>(path: string, init: RequestInit & { apiKey?: string } = {}): Promise<T> {
  const { apiKey, ...request } = init
  const headers = new Headers(init.headers)
  headers.set('API_KEY', apiKey ?? partnerApiKey!)
  if (request.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${rebyteApiUrl}${path}`, { ...request, headers })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} failed: HTTP ${res.status} ${text}`)
  return text ? JSON.parse(text) as T : {} as T
}

async function getSandboxApiKey(): Promise<SandboxApiKeyResponse> {
  if (directSandboxApiKey && directSandboxApiUrl) {
    return { apiKey: directSandboxApiKey, baseUrl: directSandboxApiUrl }
  }
  if (!partnerApiKey) {
    throw new Error('Missing SANDBOX_API_KEY/SANDBOX_API_URL or REBYTE_API_KEY.')
  }
  return rebyteJSON<SandboxApiKeyResponse>('/sandbox/api-key', {
    method: 'POST',
    body: JSON.stringify({ apiKey: partnerApiKey }),
  })
}

type AgentComputer = {
  id: string
  sandboxId?: string
  sandboxApiKey?: string
  sandboxBaseUrl?: string
}

async function createAgentComputer(i: number): Promise<AgentComputer> {
  if (!rebyteUserApiKey) throw new Error('Missing REBYTE_USER_API_KEY or REBYTE_API_KEY')
  const created = await rebyteJSON<AgentComputer>('/agent-computers', {
    method: 'POST',
    apiKey: rebyteUserApiKey,
    body: JSON.stringify({ name: `sandbox-ready-race-${Date.now()}-${i}` }),
  })
  if (created.sandboxId) return created

  for (let poll = 0; poll < 30; poll++) {
    await sleep(2000)
    const fresh = await rebyteJSON<AgentComputer>(`/agent-computers/${created.id}`, {
      apiKey: rebyteUserApiKey,
    })
    if (fresh.sandboxId) return { ...created, ...fresh }
  }
  throw new Error(`Agent computer ${created.id} did not expose sandboxId within 60s`)
}

async function deleteAgentComputer(id: string): Promise<void> {
  if (!rebyteUserApiKey) return
  await rebyteJSON(`/agent-computers/${id}`, {
    method: 'DELETE',
    apiKey: rebyteUserApiKey,
  }).catch(() => {})
}

async function main() {
  const key = await getSandboxApiKey()
  const domain = new URL(key.baseUrl).hostname
  const opts = {
    apiKey: key.apiKey,
    apiUrl: key.baseUrl,
    domain,
    timeoutMs: 5 * 60_000,
    requestTimeoutMs: 20_000,
  }

  const counts = new Map<string, number>()
  const failures: Array<{ i: number; sandboxId?: string; kind: string; error: string }> = []

  console.log(JSON.stringify({
    event: 'start',
    mode,
    iterations,
    template,
    command,
    pauseMs,
    apiUrl: key.baseUrl,
  }))

  for (let i = 1; i <= iterations; i++) {
    let sandbox: Sandbox | undefined
    let agentComputerId: string | undefined
    const started = Date.now()
    try {
      if (mode === 'agent-computer') {
        const ac = await createAgentComputer(i)
        agentComputerId = ac.id
        if (!ac.sandboxId) throw new Error(`Agent computer ${ac.id} has no sandboxId`)
        const sandboxApiKey = ac.sandboxApiKey ?? key.apiKey
        const sandboxApiUrl = ac.sandboxBaseUrl ?? key.baseUrl
        sandbox = await Sandbox.connect(ac.sandboxId, {
          ...opts,
          apiKey: sandboxApiKey,
          apiUrl: sandboxApiUrl,
          domain: new URL(sandboxApiUrl).hostname,
        })
      } else {
        sandbox = await Sandbox.create(template, opts)
      }
      const createdMs = Date.now() - started
      if (pauseMs > 0) await sleep(pauseMs)

      const runStarted = Date.now()
      const result = await sandbox.commands.run(command, {
        timeoutMs: 20_000,
        requestTimeoutMs: 20_000,
      })
      const runMs = Date.now() - runStarted
      counts.set('ok', (counts.get('ok') ?? 0) + 1)
      console.log(JSON.stringify({
        event: 'ok',
        i,
        sandboxId: sandbox.sandboxId,
        agentComputerId,
        createdMs,
        runMs,
        exitCode: result.exitCode,
      }))
    } catch (err) {
      const kind = classify(err)
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
      const error = message(err)
      failures.push({ i, sandboxId: sandbox?.sandboxId, kind, error })
      console.log(JSON.stringify({
        event: 'fail',
        i,
        sandboxId: sandbox?.sandboxId,
        agentComputerId,
        kind,
        elapsedMs: Date.now() - started,
        error: error.split('\n')[0],
      }))
    } finally {
      if (sandbox) {
        if (mode === 'agent-computer' && agentComputerId) {
          await deleteAgentComputer(agentComputerId)
        } else {
          await sandbox.kill({ requestTimeoutMs: 20_000 }).catch(err => {
            console.log(JSON.stringify({
              event: 'cleanup_failed',
              sandboxId: sandbox?.sandboxId,
              error: message(err).split('\n')[0],
            }))
          })
        }
      } else if (agentComputerId) {
        await deleteAgentComputer(agentComputerId).catch(err => {
          console.log(JSON.stringify({
            event: 'cleanup_failed',
            agentComputerId,
            error: message(err).split('\n')[0],
          }))
        })
      }
    }
  }

  const summary = Object.fromEntries([...counts.entries()].sort())
  const failureRate = iterations > 0 ? 1 - ((counts.get('ok') ?? 0) / iterations) : 0
  console.log(JSON.stringify({ event: 'summary', iterations, summary, failureRate }))
  if (failures.length) {
    console.log(JSON.stringify({
      event: 'first_failure',
      ...failures[0],
      error: failures[0].error.slice(0, 2000),
    }))
  }
}

main().catch(err => {
  console.error(JSON.stringify({ event: 'fatal', error: message(err) }))
  process.exitCode = 1
})
