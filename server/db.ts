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
import mysql from 'mysql2/promise'
import { env } from './env.js'

type DbDialect = 'postgres' | 'mysql'

const dialect: DbDialect = env.DATABASE_URL.startsWith('mysql://') || env.DATABASE_URL.startsWith('mysql2://')
  ? 'mysql'
  : 'postgres'

const pgPool = dialect === 'postgres'
  ? new Pool({
      connectionString: env.DATABASE_URL,
      // Keep the pool small — request fan-out is low and holding many idle
      // connections wastes server sockets.
      max: 10,
    })
  : null

const mysqlPool = dialect === 'mysql'
  ? mysql.createPool({
      uri: env.DATABASE_URL,
      ssl: { minVersion: 'TLSv1.2' },
      connectionLimit: 10,
      waitForConnections: true,
    })
  : null

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
): Promise<{ rows: T[]; rowCount: number }> {
  let attempt = 0
  for (;;) {
    try {
      if (dialect === 'postgres') {
        const r = await pgPool!.query<T>(sql, params as unknown[])
        return { rows: r.rows, rowCount: r.rowCount ?? 0 }
      }

      const { sql: mysqlSql, params: mysqlParams } = toMySQL(sql, params)
      const [rowsOrResult] = await mysqlPool!.query(mysqlSql, mysqlParams)
      if (Array.isArray(rowsOrResult)) {
        return { rows: rowsOrResult as T[], rowCount: rowsOrResult.length }
      }
      const result = rowsOrResult as mysql.ResultSetHeader
      return { rows: [], rowCount: result.affectedRows ?? 0 }
    } catch (err) {
      if (!isRetryableDbConnectError(err) || attempt >= 2) throw err
      attempt += 1
      await sleep(150 * attempt)
    }
  }
}

function toMySQL(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  let out = sql
    .replace(/\$([0-9]+)::jsonb/g, '$$$1')
    .replace(/\$([0-9]+)::timestamptz/g, '$$$1')
    .replace(/NULL::text AS/g, 'NULL AS')
    .replace(/count\(\*\)::text AS c/g, 'CAST(count(*) AS CHAR) AS c')
    .replace(/seq::text AS seq/g, 'CAST(seq AS CHAR) AS seq')
    .replace(/ON CONFLICT \(id\) DO NOTHING/g, 'ON DUPLICATE KEY UPDATE id = id')
    .replace(
      /ON CONFLICT \(id\) DO UPDATE\s+SET status = EXCLUDED\.status,\s+completed_at = EXCLUDED\.completed_at/g,
      'ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = VALUES(completed_at)',
    )
    .replace(
      /ON CONFLICT \(id\) DO UPDATE\s+SET email = EXCLUDED\.email,\s+name = EXCLUDED\.name,\s+avatar_url = EXCLUDED\.avatar_url,\s+updated_at = NOW\(\)/g,
      'ON DUPLICATE KEY UPDATE email = VALUES(email), name = VALUES(name), avatar_url = VALUES(avatar_url), updated_at = NOW()',
    )

  const mysqlParams: unknown[] = []
  out = out.replace(/\$([0-9]+)/g, (_m, n: string) => {
    const index = Number(n) - 1
    mysqlParams.push(params[index])
    return '?'
  })
  return { sql: out, params: mysqlParams }
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
  const row = await first<{ exists: boolean | number }>(
    dialect === 'postgres'
      ? `SELECT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = $1
              AND column_name = $2
         ) AS exists`
      : `SELECT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = $1
              AND column_name = $2
         ) AS \`exists\``,
    [table, column],
  )
  const exists = row?.exists === true || row?.exists === 1
  columnExistsCache.set(key, exists)
  return exists
}

export const db = { dialect, pool: pgPool ?? mysqlPool, first, all, run, columnExists }
