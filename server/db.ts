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

/** Single-row query. Returns null if zero rows, the first row otherwise. */
async function first<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await pool.query<T>(sql, params as unknown[])
  return r.rows[0] ?? null
}

/** Multi-row query. Always returns an array. */
async function all<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query<T>(sql, params as unknown[])
  return r.rows
}

/** Mutation. Returns the rowCount (number of rows affected). */
async function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  const r = await pool.query(sql, params as unknown[])
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
