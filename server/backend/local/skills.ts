/**
 * Local-mode skill plumbing.
 *
 * Two idempotent operations on a project's filesystem:
 *   - ensureProjectSkillLinks — run once at project init; mkdir .skills/
 *     and symlink .<cli>/skills → ../.skills for each supported CLI so
 *     every agent sees the same tree under its own expected path.
 *   - refreshProjectSkills — run before every agent turn; copy the
 *     repo's adits/skills/* into the project's .skills/. Overwrites
 *     repo-sourced files; leaves anything the user added in place.
 *
 * Hosted (ADITS_BACKEND=rebyte) never calls either of these — the relay
 * handles skill delivery server-side.
 */

import { cp, mkdir, readdir, symlink, lstat, readlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../../env.js'

/** Per-CLI discovery paths, all relative to the project root. Every CLI
 *  reads skills from `.<cli>/skills` — same shape across the board.
 *  `.claude/skills` is confirmed; the other three follow the same
 *  convention pending verification against each CLI's source. */
const CLI_SKILL_LINKS = [
  '.claude/skills',
  '.gemini/skills',
  '.codex/skills',
] as const

/** Source of truth: adits/skills/ at the repo root. Resolved relative to
 *  this module so it works under both `tsx --watch` (dev) and the built
 *  server tree (prod). This file lives at server/backend/local/skills.ts
 *  — three levels up is the repo root. */
const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_SKILLS_DIR = resolve(__dirname, '..', '..', '..', 'skills')

function projectRoot(projectId: string): string {
  return resolve(join(env.ADITS_DATA_DIR, 'projects', projectId))
}

/** Create `.skills/` and the four per-CLI symlinks under the project
 *  root. Idempotent — safe to call on every project open. If a link
 *  already exists and points at the canonical target, left alone. If
 *  something else (file, wrong-target link, real dir) is sitting at the
 *  path, we don't clobber — a warning is logged and the CLI will fall
 *  back to whatever's there. */
export async function ensureProjectSkillLinks(projectId: string): Promise<void> {
  const root = projectRoot(projectId)
  const skillsDir = join(root, '.skills')
  await mkdir(skillsDir, { recursive: true })

  for (const rel of CLI_SKILL_LINKS) {
    const linkPath = join(root, rel)
    const target = '../.skills'
    await mkdir(dirname(linkPath), { recursive: true })

    const existing = await lstat(linkPath).catch(() => null)
    if (existing?.isSymbolicLink()) {
      const current = await readlink(linkPath).catch(() => '')
      if (current === target) continue
      // Wrong-target link — rewrite it. The user didn't author this.
      try {
        await symlink(target, linkPath)
      } catch {
        // symlink() fails if the path exists; unlink-and-retry would be
        // destructive if a file appeared between lstat and symlink. Skip
        // with a warning — the CLI still has `.skills/` directly.
        console.warn(`[skills] could not rewrite stale symlink at ${linkPath}`)
      }
      continue
    }
    if (existing) {
      // A real file or directory occupies the path. Don't clobber —
      // user-authored content wins. Log so it's debuggable.
      console.warn(`[skills] ${linkPath} exists and is not a symlink; leaving alone`)
      continue
    }
    try {
      await symlink(target, linkPath)
    } catch (err) {
      console.warn(`[skills] failed to create ${linkPath}:`, (err as Error).message)
    }
  }
}

/** Copy every skill under <repo>/skills/ into <project>/.skills/. Runs
 *  before every agent turn so repo-side skill edits land in running
 *  projects immediately. Overwrite semantics (`force: true`) — the repo
 *  is the authority for repo-sourced files. Anything the user added to
 *  `.skills/` that isn't in the repo stays (no pruning). Best-effort —
 *  errors are logged; the agent still runs. */
export async function refreshProjectSkills(projectId: string): Promise<void> {
  let entries
  try {
    entries = await readdir(REPO_SKILLS_DIR, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    console.warn(`[skills] could not read ${REPO_SKILLS_DIR}:`, (err as Error).message)
    return
  }

  const dstRoot = join(projectRoot(projectId), '.skills')
  await mkdir(dstRoot, { recursive: true })

  for (const e of entries) {
    // Skip dotfiles at the source root (.gitkeep, .DS_Store) — they
    // aren't skills. A skill directory must have a non-dot name.
    if (e.name.startsWith('.')) continue
    if (!e.isDirectory()) continue
    const src = join(REPO_SKILLS_DIR, e.name)
    const dst = join(dstRoot, e.name)
    try {
      await cp(src, dst, { recursive: true, force: true, dereference: false })
    } catch (err) {
      console.warn(`[skills] copy ${e.name} failed:`, (err as Error).message)
    }
  }
}
