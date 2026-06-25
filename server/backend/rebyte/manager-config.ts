/**
 * Per-workspace manager-agent config for adits' eager-build product model.
 *
 * Since the hosted backend became an agent loop, `/v1/tasks` runs a *manager*
 * agent that owns the conversation and can call `ask_user_question` — a tool
 * that PARKS the turn in `blocked_user_answer_required` until the user answers.
 * That answer can only be delivered via a first-party endpoint
 * (`POST /api/conversations/:taskId/messages/:messageId/answer`, clerkAuth) —
 * NOT reachable from the public `/v1` API adits speaks, and the `/v1` event
 * stream doesn't even expose the `actionId`/`messageId` needed to answer. So a
 * manager `ask_user_question` strands an adits task as `running` forever.
 *
 * Until the answer capability is exposed on `/v1` (platform track), adits steers
 * the manager so it never strands a turn on its own unanswerable question:
 *   - disable the `ask_user_question` MCPServerView (hard guarantee: the manager
 *     has no blocking-question tool), and
 *   - set `agent_instructions` (soft steer: lead with action, never block on a
 *     direct question — but DON'T suppress the coding agent's own structured-
 *     questions skill, which is turn-ending and answerable via follow-up, so
 *     adaptive iterative clarification still works).
 *
 * Both applied via `PATCH /v1/agent-computers/:id` (cctools d75cef619 — the
 * `views: { mcpServerViewId: enabled }` toggle). Idempotent + best-effort: a
 * config hiccup must never fail project creation or a send.
 */

import { rebyteJSON } from './rebyte.js'

/** Internal MCP server name of the blocking question tool (cctools
 *  `ASK_USER_QUESTION_SERVER_NAME`). Used to find its view id to toggle off. */
const ASK_USER_QUESTION_INTERNAL_NAME = 'ask_user_question'

/** Appended after the manager's base prompt by the relay (getWorkspaceAsAgent).
 *  Reinforces eager-build even with the ask tool removed — the manager should
 *  proceed on a best-guess and surface assumptions, not refuse or stall. */
export const MANAGER_AGENT_INSTRUCTIONS = [
  'Adits is a consumer product: a user describes what they want — a web page, app, or design — and you deliver a working result, then refine it with them over follow-up messages. Good work is iterative; one prompt rarely nails it.',
  '',
  'How to operate:',
  '- Lead with action: delegate the building to the coding agent (it owns the project files, tools, and skills). Prefer making progress over interrogating the user.',
  '- Never block the turn to ask the user a question YOURSELF — you have no channel to receive an answer, so a direct question from you strands the task.',
  "- When a request is genuinely underspecified, that's fine: the coding agent can gather what it needs through its own structured-questions skill (it shows the user a short form, ends the turn, and continues after they answer). This adaptive, in-context clarification is correct and wanted — if the coding agent comes back needing the user's input, END your turn so the user can answer; don't guess past it.",
  '- Otherwise, make a reasonable assumption, produce something useful, and state the assumption so the user can adjust on the next turn.',
  "- If you can't act on an input (e.g. a link you can't open), do the most useful adjacent thing and say — as a statement, not a question — what you did and what you'd need to go further.",
  '- Every turn is build, clarify, or refine.',
].join('\n')

interface AgentView {
  id: string
  name: string | null
  enabled: boolean
  server: { type: string; internalName: string | null; remoteId: string | null }
}

/** Configure one agent-computer (workspace) for eager-build. GET its views to
 *  find the ask_user_question view id, then PATCH instructions + disable it. */
export async function configureManagerAgent(apiKey: string, vmId: string): Promise<void> {
  const ac = await rebyteJSON<{ views?: AgentView[] }>(`/agent-computers/${vmId}`, { apiKey })
  const askViewId = (ac.views ?? []).find(
    v => v.server?.internalName === ASK_USER_QUESTION_INTERNAL_NAME,
  )?.id

  await rebyteJSON(`/agent-computers/${vmId}`, {
    method: 'PATCH',
    apiKey,
    body: JSON.stringify({
      agent_instructions: MANAGER_AGENT_INSTRUCTIONS,
      ...(askViewId ? { views: { [askViewId]: false } } : {}),
    }),
  })
}

// Configure each VM at most once per process. The config persists server-side
// (workspace_mcp_servers + agent_instructions), so this in-memory guard only
// skips a redundant GET+PATCH on subsequent sends; a re-PATCH after a restart
// is idempotent and harmless.
const configuredVms = new Set<string>()

/** Idempotent, best-effort, once-per-process. Safe to await before any send. */
export async function ensureManagerConfigured(apiKey: string, vmId: string): Promise<void> {
  if (!vmId || configuredVms.has(vmId)) return
  configuredVms.add(vmId) // optimistic: avoid stampede on concurrent first sends
  try {
    await configureManagerAgent(apiKey, vmId)
  } catch (err) {
    configuredVms.delete(vmId) // let a later send retry
    console.warn(`[manager-config] configure failed for ${vmId}:`, (err as Error).message)
  }
}
