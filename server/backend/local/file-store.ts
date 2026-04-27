/**
 * Local-filesystem `FileStore`. Every method is jailed inside the project
 * directory at `${ADITS_DATA_DIR}/projects/<projectId>/`.
 *
 * Path safety: reject absolute inputs and any input whose resolved absolute
 * path escapes the project root after `path.resolve`. The Go file-server that
 * serves these files to the browser does its own containment check; this
 * module does it again because backend callers can also hand paths in.
 */

import { cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { db } from '../../db.js'
import { env } from '../../env.js'
import type { FileEntry, FileStore, ProjectRow } from '../file-store.js'
import { ensureProjectSkillLinks } from './skills.js'
import { getDesignSystem } from '../../../packages/shared/design-systems.js'
import { getBuildingSkill } from '../../../packages/shared/building-skills.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DESIGN_SYSTEMS_DIR = resolve(__dirname, 'design-systems')
const BUILDING_SKILLS_DIR = resolve(__dirname, 'building-skills')

function projectRoot(projectId: string): string {
  return resolve(join(env.ADITS_DATA_DIR, 'projects', projectId))
}

/** Lexical containment — resolve the path against the project root and
 *  assert it doesn't escape via `..`. Strips the hosted `/code` prefix if
 *  present so callers still using that convention (e.g. sample seed)
 *  transparently work. */
function lexicalResolve(projectId: string, path: string): string {
  let p = path
  if (p.startsWith('/code/')) p = p.slice('/code/'.length)
  else if (p === '/code') p = ''
  else if (isAbsolute(p)) {
    throw new Error(`LocalFileStore: absolute path rejected: ${path}`)
  }
  const root = projectRoot(projectId)
  const abs = resolve(root, p)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`LocalFileStore: path escapes project root: ${path}`)
  }
  return abs
}

/** Walk each existing ancestor of `abs` down from the project root and
 *  refuse if any segment is a symlink. This blocks `mkdir(link/subdir,
 *  recursive)` from silently escaping the jail when `link` points
 *  outside the project. Must be called BEFORE any mkdir/open that might
 *  follow a symlink. */
async function assertNoSymlinkAncestors(projectId: string, abs: string): Promise<void> {
  const root = projectRoot(projectId)
  if (!abs.startsWith(root)) {
    throw new Error(`LocalFileStore: target not under project root: ${abs}`)
  }
  const tail = abs.slice(root.length).replace(/^\/+/, '')
  if (!tail) return
  const parts = tail.split('/')
  let cursor = root
  for (const part of parts) {
    cursor = join(cursor, part)
    const s = await lstat(cursor).catch(() => null)
    if (!s) return // nonexistent from here down — nothing to follow
    if (s.isSymbolicLink()) {
      throw new Error(`LocalFileStore: refusing to traverse symlink in project path: ${cursor}`)
    }
  }
}

/** Post-hoc sanity check after the operation: realpath the target and
 *  make sure it still lives under the project root. Belt-and-suspenders
 *  for paths that mkdir/open may have resolved in ways we didn't catch. */
async function assertRealpathJailed(projectId: string, abs: string): Promise<void> {
  const root = await realpath(projectRoot(projectId)).catch(() => projectRoot(projectId))
  let real: string
  try {
    real = await realpath(abs)
  } catch {
    // Nonexistent — the caller will surface ENOENT itself.
    return
  }
  const rel = relative(root, real)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`LocalFileStore: resolved path escapes project root via symlink: ${abs}`)
  }
}

async function walk(absRoot: string, relBase: string, out: FileEntry[], depth: number): Promise<void> {
  if (depth < 0) return
  let entries
  try {
    entries = await readdir(absRoot, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const e of entries) {
    // Skip symlinks outright. Dirent.isDirectory() follows symlinks on
    // some platforms, which would let a link planted inside the project
    // tree expose files from outside during `list()`.
    if (e.isSymbolicLink()) continue
    // Skip dotfile entries at every level — `.skills/`, `.claude/`,
    // `.gemini/`, `.codex/` are execution-model plumbing, plus OS
    // cruft like `.DS_Store`. None of it belongs in the user's Design
    // Files browser.
    if (e.name.startsWith('.')) continue
    const absPath = join(absRoot, e.name)
    const relPath = relBase ? `${relBase}/${e.name}` : e.name
    if (e.isDirectory()) {
      await walk(absPath, relPath, out, depth - 1)
    } else if (e.isFile()) {
      const s = await stat(absPath)
      out.push({
        path: relPath,
        name: e.name,
        size: s.size,
        mtime: s.mtime.toISOString(),
      })
    }
  }
}

/** Shape the `projects` table returns — used by lifecycle methods to
 *  hand a ProjectRow back to the route. Keep in sync with migration 001
 *  plus 003 (vm_id). */
interface ProjectDbRow {
  id: string
  name: string
  user_id: string
  workspace_id: string
  vm_id: string | null
  created_at: Date
}

function rowToJSON(row: ProjectDbRow): ProjectRow {
  return {
    id: row.id,
    name: row.name,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    vm_id: row.vm_id,
    created_at: row.created_at.toISOString(),
  }
}

export const localFileStore: FileStore = {
  async list(_userId, projectId, path, opts) {
    // `path` is the subtree root relative to project root. Empty / '.' / '/'
    // all mean "project root". Check ancestors BEFORE mkdir so we don't
    // create dirs through a symlink that escapes the jail.
    const subtreeAbs = lexicalResolve(projectId, path || '.')
    await assertNoSymlinkAncestors(projectId, subtreeAbs)
    await mkdir(subtreeAbs, { recursive: true })
    await assertRealpathJailed(projectId, subtreeAbs)
    const out: FileEntry[] = []
    await walk(subtreeAbs, path && path !== '.' ? path : '', out, opts?.depth ?? 5)
    return out
  },

  async read(_userId, projectId, path) {
    const abs = lexicalResolve(projectId, path)
    await assertNoSymlinkAncestors(projectId, abs)
    await assertRealpathJailed(projectId, abs)
    const buf = await readFile(abs)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  },

  async write(_userId, projectId, path, bytes) {
    const abs = lexicalResolve(projectId, path)
    await assertNoSymlinkAncestors(projectId, abs)
    await mkdir(dirname(abs), { recursive: true })
    await assertRealpathJailed(projectId, dirname(abs))
    // Belt: lstat the final target. Even if ancestors are clean, someone
    // may have planted a symlink AT the target in the gap between checks.
    const targetStat = await lstat(abs).catch(() => null)
    if (targetStat && targetStat.isSymbolicLink()) {
      throw new Error(`LocalFileStore: refusing to write through symlink at ${abs}`)
    }
    await writeFile(abs, bytes)
  },

  async remove(_userId, projectId, path) {
    const abs = lexicalResolve(projectId, path)
    await assertNoSymlinkAncestors(projectId, abs)
    await assertRealpathJailed(projectId, abs)
    await rm(abs, { force: true })
  },

  /** Local createProject: mkdir the project root, materialize the per-CLI
   *  skill-discovery symlinks (so whichever agent the user spawns can find
   *  skills under its own expected path), INSERT the row. `vm_id` is NULL;
   *  `workspace_id` keeps the identity-hack value (= projectId) for event
   *  routing until that column is retired. */
  async createProject({ userId, projectId, name }) {
    await mkdir(projectRoot(projectId), { recursive: true })
    await ensureProjectSkillLinks(projectId)
    try {
      const row = await db.first<ProjectDbRow>(
        `INSERT INTO projects (id, user_id, name, workspace_id, vm_id, owns_workspace, sandbox_config)
         VALUES ($1, $2, $3, $1, NULL, 1, NULL)
         RETURNING id, user_id, name, workspace_id, vm_id, created_at`,
        [projectId, userId, name],
      )
      if (!row) throw new Error('localFileStore.createProject: INSERT returned no row')
      return rowToJSON(row)
    } catch (err) {
      // Compensating action: if the INSERT fails (e.g. conflicting id),
      // roll back the mkdir so we don't leak an orphan project dir.
      await rm(projectRoot(projectId), { recursive: true, force: true }).catch(() => {})
      throw err
    }
  },

  /** Local deleteProject: DELETE the row, rm -rf the project dir. Returns
   *  false if the row didn't exist so the route can map to 404. */
  async deleteProject({ userId, projectId }) {
    const result = await db.run(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, userId],
    )
    if (!result.changes) return false
    await rm(projectRoot(projectId), { recursive: true, force: true }).catch(() => {})
    return true
  },

  /** Local duplicateProject: copy the source dir, insert a new row with
   *  "<name> (Copy)". `fs.cp` handles the recursive case; symlinks (the
   *  skill-discovery links planted by createProject) are copied as
   *  symlinks — the new dir's own skill targets resolve via ADITS_DATA_DIR
   *  so they stay valid. Returns null if the source row is missing. */
  async duplicateProject({ userId, sourceId }) {
    const source = await db.first<{ name: string }>(
      'SELECT name FROM projects WHERE id = $1 AND user_id = $2',
      [sourceId, userId],
    )
    if (!source) return null

    const newId = randomUUID()
    const newName = `${source.name} (Copy)`
    const srcDir = projectRoot(sourceId)
    const dstDir = projectRoot(newId)

    await mkdir(dstDir, { recursive: true })
    try {
      await cp(srcDir, dstDir, { recursive: true, errorOnExist: false })
    } catch (err) {
      await rm(dstDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }

    try {
      const row = await db.first<ProjectDbRow>(
        `INSERT INTO projects (id, user_id, name, workspace_id, vm_id, owns_workspace, sandbox_config)
         VALUES ($1, $2, $3, $1, NULL, 1, NULL)
         RETURNING id, user_id, name, workspace_id, vm_id, created_at`,
        [newId, userId, newName],
      )
      if (!row) throw new Error('localFileStore.duplicateProject: INSERT returned no row')
      return rowToJSON(row)
    } catch (err) {
      await rm(dstDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  },

  /** Local applyDesignSystem: copy the preset's `impeccable.md` into the
   *  project root as `.impeccable.md`, and copy any `assets/` subtree
   *  into `.skills/design-systems/<id>/`. The id must be registered in
   *  `DESIGN_SYSTEMS` AND have backing files on disk — unknown ids,
   *  unowned projects, and missing source content are all hard errors. */
  async applyDesignSystem({ userId, projectId, id }) {
    if (!getDesignSystem(id)) {
      throw new Error(`LocalFileStore.applyDesignSystem: unknown design system "${id}"`)
    }
    const owner = await db.first<{ id: string }>(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, userId],
    )
    if (!owner) {
      throw new Error(`LocalFileStore.applyDesignSystem: project ${projectId} not found for user`)
    }

    const srcDir = join(DESIGN_SYSTEMS_DIR, id)
    const impeccableSrc = join(srcDir, 'impeccable.md')
    const impeccableStat = await stat(impeccableSrc).catch(() => null)
    if (!impeccableStat?.isFile()) {
      throw new Error(`LocalFileStore.applyDesignSystem: missing preset content at ${impeccableSrc}`)
    }

    const dstImpeccable = lexicalResolve(projectId, '.impeccable.md')
    await assertNoSymlinkAncestors(projectId, dstImpeccable)
    await mkdir(dirname(dstImpeccable), { recursive: true })
    const targetLstat = await lstat(dstImpeccable).catch(() => null)
    if (targetLstat?.isSymbolicLink()) {
      throw new Error(`LocalFileStore.applyDesignSystem: refusing to write through symlink at ${dstImpeccable}`)
    }
    const bytes = await readFile(impeccableSrc)
    await writeFile(dstImpeccable, bytes)
    await assertRealpathJailed(projectId, dstImpeccable)

    const assetsSrc = join(srcDir, 'assets')
    const assetsStat = await stat(assetsSrc).catch(() => null)
    if (assetsStat?.isDirectory()) {
      const dstAssets = lexicalResolve(projectId, join('.skills', 'design-systems', id))
      await assertNoSymlinkAncestors(projectId, dstAssets)
      await mkdir(dstAssets, { recursive: true })
      await assertRealpathJailed(projectId, dstAssets)
      await cp(assetsSrc, dstAssets, { recursive: true, errorOnExist: false })
    }
  },

  /** Local applyBuildingSkill: copy the skill's directory into
   *  `.skills/building/<id>/`. Same contract as applyDesignSystem — id
   *  must be registered, project must belong to the user, source must
   *  exist. No defaults, no silent fallback. */
  async applyBuildingSkill({ userId, projectId, id }) {
    if (!getBuildingSkill(id)) {
      throw new Error(`LocalFileStore.applyBuildingSkill: unknown building skill "${id}"`)
    }
    const owner = await db.first<{ id: string }>(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, userId],
    )
    if (!owner) {
      throw new Error(`LocalFileStore.applyBuildingSkill: project ${projectId} not found for user`)
    }

    const srcDir = join(BUILDING_SKILLS_DIR, id)
    const srcStat = await stat(srcDir).catch(() => null)
    if (!srcStat?.isDirectory()) {
      throw new Error(`LocalFileStore.applyBuildingSkill: missing source dir at ${srcDir}`)
    }

    const dstDir = lexicalResolve(projectId, join('.skills', 'building', id))
    await assertNoSymlinkAncestors(projectId, dstDir)
    await mkdir(dstDir, { recursive: true })
    await assertRealpathJailed(projectId, dstDir)
    await cp(srcDir, dstDir, { recursive: true, errorOnExist: false })
  },
}
