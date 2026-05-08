/**
 * Postgres pool. One module-level instance for the whole process.
 *
 * The codebase was previously on Cloudflare D1 — every call site looked like
 *   `await env.DB.prepare('SELECT ...').bind(a, b).first<Row>()`
 * which is D1's template-style API. On Postgres via `pg`, the equivalent is
 *   `const { rows } = await db.query<Row>('SELECT ... WHERE x=$1 AND y=$2', [a, b])`
 *
 * To keep the porting diff small, `db` exposes a thin helper that matches the
 * old call shape as closely as possible: `db.first()`, `db.all()`, `db.run()`.
 * The query string must use `$1, $2, …` positional placeholders (Postgres
 * convention), not D1's `?`.
 */

import { Pool, type QueryResultRow } from 'pg'
import { env } from './env.js'

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Keep the pool small — request fan-out is low and holding many idle
  // connections wastes server sockets.
  max: 10,
})

const RETRYABLE_DB_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
])

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableDbConnectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = 'code' in err ? (err as { code?: unknown }).code : undefined
  if (typeof code === 'string' && RETRYABLE_DB_CODES.has(code)) return true
  if (err instanceof AggregateError) {
    return err.errors.length > 0 && err.errors.every(child => isRetryableDbConnectError(child))
  }
  const nested = 'errors' in err ? (err as { errors?: unknown }).errors : undefined
  if (Array.isArray(nested)) {
    return nested.length > 0 && nested.every(child => isRetryableDbConnectError(child))
  }
  return false
}

async function queryWithRetry<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<ReturnType<Pool['query<T>']> extends Promise<infer R> ? R : never> {
  let attempt = 0
  for (;;) {
    try {
      return await pool.query<T>(sql, params as unknown[])
    } catch (err) {
      if (!isRetryableDbConnectError(err) || attempt >= 2) throw err
      attempt += 1
      await sleep(150 * attempt)
    }
  }
}

/** Single-row query. Returns null if zero rows, the first row otherwise. */
async function first<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await queryWithRetry<T>(sql, params)
  return r.rows[0] ?? null
}

/** Multi-row query. Always returns an array. */
async function all<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await queryWithRetry<T>(sql, params)
  return r.rows
}

/** Mutation. Returns the rowCount (number of rows affected). */
async function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  const r = await queryWithRetry(sql, params)
  return { changes: r.rowCount ?? 0 }
}

const columnExistsCache = new Map<string, boolean>()

async function columnExists(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  const cached = columnExistsCache.get(key)
  if (cached !== undefined) return cached
  const row = await first<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = $2
     ) AS exists`,
    [table, column],
  )
  const exists = row?.exists === true
  columnExistsCache.set(key, exists)
  return exists
}

export const db = { pool, first, all, run, columnExists }
