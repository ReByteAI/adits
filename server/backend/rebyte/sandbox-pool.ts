/**
 * Per-project Sandbox handle cache with single-flight and TTL.
 *
 * Sandboxes are Lambdas in this codebase: any `Sandbox.connect()` to a
 * paused VM auto-resumes via the sandbox gateway's `ensure_resumed`
 * coalescer. We never pre-warm or keep-alive. The pool's only job is
 * request coalescing: a single user action can trigger 10+ concurrent
 * backend calls, and we don't want each to independently re-do the
 * connect / envd-readiness / file-server install dance.
 *
 * Strategy: hold the connected `Sandbox` handle in an in-process Map,
 * keyed by `projectId`. Single-flight via a shared `inflight` promise
 * so 10 concurrent cold arrivals trigger exactly one connect. TTL is
 * an optimization to skip the DB+envd round-trip on close-following
 * calls; the correctness invariant is "any call that fails with a
 * sandbox-not-ready signal invalidates the entry, next call
 * re-prepares." That's what `withProjectSandbox` enforces.
 *
 * Scope: in-process only. If Cloud Run horizontal-scales, each instance
 * warms its own cache on first cold hit per projectId — N×1, not N×10.
 * Redis would buy cross-instance sharing; not worth it until metrics
 * demand it.
 */

import { ErrorCode, Sandbox, SandboxError, TimeoutError } from 'rebyte-sandbox'
import { connectProjectSandbox } from './sandbox.js'

const TTL_MS = 3 * 60 * 1000

interface Entry {
  sandbox?: Sandbox
  validUntil: number
  inflight?: Promise<Sandbox>
}

const pool = new Map<string, Entry>()

/** Get a cached, prepared Sandbox for this project, or prepare one.
 *
 *  Supersession safety: if an earlier invocation of this function is
 *  still awaiting its `connectProjectSandbox` when the entry gets
 *  invalidated and a newer preparation starts, the older resolution
 *  must not overwrite or delete the newer entry. We enforce this by
 *  only mutating the map when the stored `inflight` still matches the
 *  promise we started. Any stale resolve/reject is a no-op on the pool. */
export async function getProjectSandbox(userId: string, projectId: string): Promise<Sandbox> {
  const existing = pool.get(projectId)
  const now = Date.now()

  if (existing?.inflight) return existing.inflight
  if (existing?.sandbox && existing.validUntil > now) return existing.sandbox

  const inflight = connectProjectSandbox(userId, projectId)
  pool.set(projectId, { sandbox: existing?.sandbox, validUntil: 0, inflight })

  try {
    const sandbox = await inflight
    if (pool.get(projectId)?.inflight === inflight) {
      pool.set(projectId, { sandbox, validUntil: Date.now() + TTL_MS })
    }
    return sandbox
  } catch (err) {
    if (pool.get(projectId)?.inflight === inflight) pool.delete(projectId)
    throw err
  }
}

/** Drop the cache entry for a project. Called on any error that suggests
 *  the cached sandbox is no longer usable (see `isSandboxNotReady`). */
export function invalidateProjectSandbox(projectId: string): void {
  pool.delete(projectId)
}

/** Error codes that mean "the cached Sandbox can't serve requests." */
const NOT_READY_CODES: ReadonlySet<string> = new Set([
  ErrorCode.SANDBOX_NOT_FOUND,
  ErrorCode.SANDBOX_PAUSING,
  ErrorCode.SANDBOX_KILLING,
  ErrorCode.RESUME_FAILED,
  ErrorCode.TRANSITION_FAILED,
])

export function isSandboxNotReady(err: unknown): boolean {
  if (err instanceof TimeoutError) return true
  if (err instanceof SandboxError && err.errorCode && NOT_READY_CODES.has(err.errorCode)) return true
  return false
}

/** Standard pattern: run `op(sbx)` against a pooled Sandbox. On a
 *  sandbox-not-ready error, invalidate and retry the op once through
 *  the cold path. If the retry also fails with a not-ready error, we
 *  invalidate again before propagating so the next caller doesn't
 *  inherit a known-bad cached entry. Non-not-ready errors propagate
 *  untouched (the cache is still fine; the op itself failed for a
 *  different reason). */
export async function withProjectSandbox<T>(
  userId: string,
  projectId: string,
  op: (sbx: Sandbox) => Promise<T>,
): Promise<T> {
  const sbx = await getProjectSandbox(userId, projectId)
  try {
    return await op(sbx)
  } catch (err) {
    if (!isSandboxNotReady(err)) throw err
    invalidateProjectSandbox(projectId)
    const fresh = await getProjectSandbox(userId, projectId)
    try {
      return await op(fresh)
    } catch (retryErr) {
      if (isSandboxNotReady(retryErr)) invalidateProjectSandbox(projectId)
      throw retryErr
    }
  }
}
