/**
 * Per-user Rebyte account + API-key plumbing. Ported from
 * `functions/rebyte-auth.ts`. Differences from the Cloudflare version:
 *   - D1 calls swapped for pg-flavored db helpers ($1 placeholders, NOW()).
 *   - `rebyteJSON` no longer takes an `env` parameter.
 *   - `ctx.waitUntil(...)` becomes a plain fire-and-forget promise — on Node
 *     the process stays alive between requests so there's nothing to keep
 *     alive explicitly.
 */

import { HTTPException } from 'hono/http-exception'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { rebyteJSON } from './rebyte.js'

/** Events we subscribe to. Only terminal transitions matter — reconcileTask's
 *  monotonic guard drops anything but running → terminal. */
const WEBHOOK_EVENTS = ['task.completed', 'task.failed', 'task.canceled'] as const

interface RebyteWebhook {
  id: string
  url: string
  isActive?: boolean
}

/** Ensure a Rebyte webhook exists for this user's per-user org, pointing at
 *  our /api/app/webhooks/rebyte endpoint, and remember its id on the user
 *  row so future calls short-circuit. Idempotent, never throws. */
export async function ensureUserWebhook(userId: string, apiKey: string): Promise<void> {
  try {
    const publicUrl = env.ADITS_PUBLIC_URL
    if (!publicUrl) {
      console.warn('[ensureUserWebhook] ADITS_PUBLIC_URL not set — skipping webhook registration')
      return
    }
    const targetUrl = `${publicUrl.replace(/\/$/, '')}/api/app/webhooks/rebyte`

    const row = await db.first<{ rebyte_webhook_id: string | null }>(
      'SELECT rebyte_webhook_id FROM users WHERE id = $1',
      [userId],
    )
    if (row?.rebyte_webhook_id) return

    // GET first to avoid duplicating an existing webhook. Rebyte's POST
    // /webhooks doesn't dedupe by URL, so two racing registrations would
    // create two rows and double-fire every future event.
    const list = await rebyteJSON<{ webhooks?: RebyteWebhook[] }>('/webhooks', { apiKey })
    const existing = list.webhooks?.find(w => w.url === targetUrl)

    let webhookId: string
    if (existing) {
      webhookId = existing.id
    } else {
      const created = await rebyteJSON<{ id: string }>('/webhooks', {
        method: 'POST',
        apiKey,
        body: JSON.stringify({
          url: targetUrl,
          events: WEBHOOK_EVENTS,
          secret: env.REBYTE_WEBHOOK_SECRET,
        }),
      })
      webhookId = created.id
    }

    await db.run(
      `UPDATE users SET rebyte_webhook_id = $1, updated_at = NOW()
       WHERE id = $2 AND rebyte_webhook_id IS NULL`,
      [webhookId, userId],
    )
    console.log(`[ensureUserWebhook] webhook ${webhookId} registered for user ${userId}`)
  } catch (err) {
    console.warn(`[ensureUserWebhook] failed for user ${userId}:`, (err as Error).message)
  }
}

/** Provision a headless Rebyte account for a user via the partner API. */
export async function provisionRebyteAccount(
  userId: string,
  name: string,
): Promise<{ accountId: string; apiKey: string } | null> {
  const existing = await db.first<{ rebyte_api_key: string | null }>(
    'SELECT rebyte_api_key FROM users WHERE id = $1',
    [userId],
  )
  if (existing?.rebyte_api_key) return null

  const result = await rebyteJSON<{ id: string; api_key: string }>(
    '/accounts',
    { method: 'POST', body: JSON.stringify({ name: name || userId }), apiKey: env.REBYTE_API_KEY },
  )
  // CAS guard: only set if not already provisioned.
  const update = await db.run(
    `UPDATE users SET rebyte_account_id = $1, rebyte_api_key = $2, updated_at = NOW()
     WHERE id = $3 AND rebyte_api_key IS NULL`,
    [result.id, result.api_key, userId],
  )
  if (!update.changes) {
    console.warn(`[provisionRebyteAccount] Race lost — orphaned Rebyte account ${result.id} for user ${userId}`)
    return null
  }
  return { accountId: result.id, apiKey: result.api_key }
}

/** Get the user's Rebyte API key, provisioning on-demand if missing. */
export async function requireUserRebyteKey(userId: string): Promise<string> {
  const row = await db.first<{
    rebyte_api_key: string | null
    rebyte_webhook_id: string | null
    name: string | null
    email: string
  }>(
    'SELECT rebyte_api_key, rebyte_webhook_id, name, email FROM users WHERE id = $1',
    [userId],
  )

  if (!row) throw new HTTPException(409, { message: 'User profile not synced yet. Call POST /api/app/me first.' })
  if (row.rebyte_api_key) {
    // Opportunistic webhook backfill for users created before the column
    // existed. Fire-and-forget: on Node the promise lifecycle is decoupled
    // from the response, so we don't need Cloudflare's waitUntil dance.
    if (!row.rebyte_webhook_id) {
      void ensureUserWebhook(userId, row.rebyte_api_key)
    }
    return row.rebyte_api_key
  }

  try {
    const result = await provisionRebyteAccount(userId, row.name ?? row.email ?? userId)
    if (result) {
      void ensureUserWebhook(userId, result.apiKey)
      return result.apiKey
    }
    const reread = await db.first<{ rebyte_api_key: string | null }>(
      'SELECT rebyte_api_key FROM users WHERE id = $1',
      [userId],
    )
    if (reread?.rebyte_api_key) {
      void ensureUserWebhook(userId, reread.rebyte_api_key)
      return reread.rebyte_api_key
    }
  } catch (err) {
    console.error('[requireUserRebyteKey] Failed to provision Rebyte account', (err as Error).message)
  }
  throw new HTTPException(503, { message: 'Rebyte account provisioning failed. Try again.' })
}
