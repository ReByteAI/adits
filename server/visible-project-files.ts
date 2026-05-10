import { classifyPath, detectType } from '../packages/shared/file-types/index.js'

export const SANDBOX_FILE_ROOT = '/code'
export const MAX_VISIBLE_PROJECT_DEPTH = 3

const HIDDEN_FILE_NAMES = new Set([
  'agent.md',
  'agents.md',
  'claude.md',
  'claude.local.md',
  'gemini.md',
])

function toProjectRelativePath(path: string): string {
  if (path.startsWith(SANDBOX_FILE_ROOT + '/')) return path.slice(SANDBOX_FILE_ROOT.length + 1)
  return path.replace(/^\/+/, '')
}

export function isHiddenProjectPath(path: string): boolean {
  const rel = toProjectRelativePath(path)
  if (!rel) return true
  const parts = rel.split('/')
  if (parts.some(seg => !seg || seg === '.' || seg === '..' || seg.startsWith('.'))) return true
  const name = parts[parts.length - 1] ?? ''
  return HIDDEN_FILE_NAMES.has(name.toLowerCase())
}

export function isUserVisibleProjectArtifact(path: string): boolean {
  const rel = toProjectRelativePath(path)
  if (!rel || isHiddenProjectPath(rel)) return false

  const parts = rel.split('/')
  if (parts.length > MAX_VISIBLE_PROJECT_DEPTH) return false

  const name = parts[parts.length - 1] ?? ''
  const type = detectType(name).key
  if (type === 'file') return false

  const role = classifyPath(rel)
  return role !== 'other' || parts.length === 1
}
