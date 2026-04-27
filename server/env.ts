/**
 * Process-wide env resolved once at boot. Reading `process.env` repeatedly
 * inside request handlers is legal but loses type safety and obscures the
 * "what secrets does this service need?" answer. This module is the answer.
 *
 * Local dev loads `.env.local` via `--env-file` (Node) or the tsx dev script.
 * Cloud Run injects env vars via the service definition (see scripts/deploy.sh).
 */

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function backendMode(): 'rebyte' | 'local' {
  const raw = process.env.ADITS_BACKEND ?? 'rebyte'
  if (raw !== 'rebyte' && raw !== 'local') {
    throw new Error(`Invalid ADITS_BACKEND: '${raw}'. Expected 'rebyte' or 'local'.`)
  }
  return raw
}

const BACKEND = backendMode()

/** Required only when running against the hosted Rebyte backend. When
 *  ADITS_BACKEND=local, these are unused and don't need to be set — the
 *  backend selector (server/backend/index.ts) throws the real error first
 *  so the user sees a precise "local mode not yet implemented" message
 *  instead of "Missing required env var: CLERK_SECRET_KEY". */
function rebyteRequired(name: string): string {
  return BACKEND === 'rebyte' ? required(name) : (process.env[name] ?? '')
}

export const env = {
  PORT: parseInt(process.env.PORT ?? '4001', 10),
  DATABASE_URL: required('DATABASE_URL'),

  /** Which backend implementation to run. `rebyte` = hosted (Rebyte VM +
   *  Sandbox SDK, Clerk auth). `local` = self-hosted single-user. */
  ADITS_BACKEND: BACKEND,

  CLERK_SECRET_KEY: rebyteRequired('CLERK_SECRET_KEY'),
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,

  REBYTE_API_URL: process.env.REBYTE_API_URL ?? 'https://api.rebyte.ai/v1',
  REBYTE_CONSOLE_URL: process.env.REBYTE_CONSOLE_URL ?? 'https://app.rebyte.ai/share',
  REBYTE_API_KEY: rebyteRequired('REBYTE_API_KEY'),
  REBYTE_WEBHOOK_SECRET: rebyteRequired('REBYTE_WEBHOOK_SECRET'),

  /** Public base URL used when telling Rebyte where to POST webhooks.
   *  On Cloud Run this is the service URL (e.g. https://adits-api-xxx.run.app).
   *  In dev it's the Tailscale Funnel URL. */
  ADITS_PUBLIC_URL: process.env.ADITS_PUBLIC_URL,

  /** Directory containing the Vite build output. Served at root. */
  STATIC_DIR: process.env.STATIC_DIR ?? 'build',

  /** Redis used for SSE pub/sub. Dev: localhost:6379.
   *  Prod: Cloud Memorystore or Upstash — swap via env var. */
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',

  /** Local mode: root directory for local-backend data (projects tree + any
   *  future local-only storage). Default is `~/.adits`. Irrelevant when
   *  ADITS_BACKEND=rebyte. */
  ADITS_DATA_DIR: process.env.ADITS_DATA_DIR ?? `${process.env.HOME}/.adits`,

  /** Local mode: port the child-process adits-file-server binary binds to.
   *  Default 8082 (8080 in hosted is per-VM on the Rebyte subdomain; 8081
   *  is Expo's dev server default, which the mobile app in apps/mobile/
   *  uses). */
  FILE_SERVER_PORT: parseInt(process.env.FILE_SERVER_PORT ?? '8082', 10),
}

export type Env = typeof env
