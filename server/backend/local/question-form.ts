/**
 * End-of-turn consumer for the `ask-design-questions` skill.
 *
 * The agent writes `<project-root>/.adits/questions.json` to surface a
 * structured question form. At turn-end, the task-runner calls
 * `consumeQuestionsFile(projectId)` → parsed payload (or `null`). On
 * success the runner stashes the payload onto the prompt row inside the
 * same atomic guard that flips terminal status, then calls
 * `deleteQuestionsFile` so the file doesn't re-surface on follow-up
 * turns.
 *
 * Validation is hand-rolled (no ajv dependency) — the schema is small,
 * stable, and mirrored in `skills/ask-design-questions/schema.json`.
 * Keep the two in lockstep.
 *
 * All helpers are best-effort: any read/parse/validate failure returns
 * `null` with a `console.warn`; the agent turn still completes normally.
 * An emitted-but-malformed file is the agent's bug to fix — we don't
 * block terminal transitions on it.
 */

import { readFile, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { env } from '../../env.js'
import type { AskDesignQuestionsPayload } from '../../../packages/shared/ask-design-questions.js'

const QUESTIONS_FILE = '.adits/questions.json'

function questionsPath(projectId: string): string {
  return resolve(join(env.ADITS_DATA_DIR, 'projects', projectId, QUESTIONS_FILE))
}

/** Read + parse + validate the questions file. Returns `null` if the
 *  file is missing, unreadable, or doesn't conform. Does NOT delete the
 *  file — deletion only happens on the winning terminal path, via
 *  `deleteQuestionsFile`. */
export async function consumeQuestionsFile(
  projectId: string,
): Promise<AskDesignQuestionsPayload | null> {
  const path = questionsPath(projectId)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[question-form] read failed:', (err as Error).message)
    }
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.warn('[question-form] invalid JSON in', path, ':', (err as Error).message)
    return null
  }
  const reason = validate(parsed)
  if (reason) {
    console.warn('[question-form] schema violation in', path, ':', reason)
    return null
  }
  return parsed as AskDesignQuestionsPayload
}

export async function deleteQuestionsFile(projectId: string): Promise<void> {
  try {
    await unlink(questionsPath(projectId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[question-form] delete failed:', (err as Error).message)
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal hand-rolled validator. Mirrors `skills/ask-design-questions/
// schema.json`. Returns `null` on success, or a human-readable failure
// reason string. Keep lean — we only need yes/no + a log line, not a
// structured error tree.
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z][a-z0-9_]*$/
const QUESTION_TYPES = new Set(['choice', 'text', 'file'])

function validate(value: unknown): string | null {
  if (!isObject(value)) return 'payload is not an object'
  const title = (value as Record<string, unknown>).title
  if (typeof title !== 'string' || title.length === 0 || title.length > 120)
    return 'title must be a string of 1–120 chars'
  const questions = (value as Record<string, unknown>).questions
  if (!Array.isArray(questions)) return 'questions must be an array'
  if (questions.length < 1 || questions.length > 8)
    return 'questions must have 1–8 items'
  const seenIds = new Set<string>()
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const reason = validateQuestion(q, seenIds)
    if (reason) return `question[${i}]: ${reason}`
  }
  return null
}

function validateQuestion(q: unknown, seenIds: Set<string>): string | null {
  if (!isObject(q)) return 'not an object'
  const rec = q as Record<string, unknown>
  if (typeof rec.id !== 'string' || !ID_RE.test(rec.id) || rec.id.length > 40)
    return 'id must match /^[a-z][a-z0-9_]*$/ and be ≤40 chars'
  if (seenIds.has(rec.id)) return `duplicate id '${rec.id}'`
  seenIds.add(rec.id)
  if (typeof rec.label !== 'string' || rec.label.length === 0 || rec.label.length > 200)
    return 'label must be a string of 1–200 chars'
  if (rec.hint !== undefined && (typeof rec.hint !== 'string' || rec.hint.length > 300))
    return 'hint must be a string ≤300 chars'
  if (typeof rec.type !== 'string' || !QUESTION_TYPES.has(rec.type))
    return `type must be one of choice/text/file`
  if (rec.type === 'choice') return validateChoice(rec)
  if (rec.type === 'text') return validateText(rec)
  if (rec.type === 'file') return validateFile(rec)
  return null
}

function validateChoice(rec: Record<string, unknown>): string | null {
  const opts = rec.options
  if (!Array.isArray(opts)) return 'choice.options must be an array'
  if (opts.length < 2 || opts.length > 12)
    return 'choice.options must have 2–12 items'
  const seen = new Set<string>()
  for (const o of opts) {
    if (typeof o !== 'string' || o.length === 0 || o.length > 80)
      return 'choice.options entries must be strings of 1–80 chars'
    if (seen.has(o)) return `choice.options duplicate '${o}'`
    seen.add(o)
  }
  for (const flag of ['allowOther', 'allowExplore', 'allowDecideForMe'] as const) {
    if (rec[flag] !== undefined && typeof rec[flag] !== 'boolean')
      return `choice.${flag} must be boolean`
  }
  return null
}

function validateText(rec: Record<string, unknown>): string | null {
  if (rec.allowImageAttachment !== undefined && typeof rec.allowImageAttachment !== 'boolean')
    return 'text.allowImageAttachment must be boolean'
  return null
}

function validateFile(_rec: Record<string, unknown>): string | null {
  return null
}

function isObject(v: unknown): v is object {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
