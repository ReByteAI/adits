/**
 * JWT auth middleware — ports `functions/auth.ts` from the Cloudflare
 * Pages Functions bindings pattern (`c.env.CLERK_SECRET_KEY`) to the Node
 * pattern (read from process-level `env` object at module load).
 */

import { createMiddleware } from 'hono/factory'
import { verifyToken } from '@clerk/backend'
import { env } from './env.js'

type AuthEnv = { Variables: { userId: string } }

/** Local mode: single-user, no token verification — the OS user is the
 *  account. We stamp a fixed `'local'` userId on every request and move on. */
export const LOCAL_USER_ID = 'local'

/** Pulls the Authorization bearer (or a `?token=` query param as a fallback
 *  for EventSource, which can't set headers), verifies it against Clerk, and
 *  stuffs the resolved userId on `c.var.userId`. 401s on anything that
 *  doesn't verify. In local mode, bypasses all of this and sets the fixed
 *  `LOCAL_USER_ID`. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  if (env.ADITS_BACKEND === 'local') {
    c.set('userId', LOCAL_USER_ID)
    await next()
    return
  }

  const header = c.req.header('Authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const token = bearer ?? c.req.query('token') ?? null

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY })
    c.set('userId', payload.sub)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
})
