import type { Sandbox } from 'rebyte-sandbox'
import { connectProjectSandbox } from './sandbox.js'

const ARTIFACT_BASE_URL = 'https://raw.githubusercontent.com/ReByteAI/adits/main/hosted-artifacts'
const PROJECT_ROOT = '/code'
const SANDBOX_SKILLS_ROOT = '/home/user/.skills'

function pyString(value: string): string {
  return JSON.stringify(value)
}

async function runSandboxCommand(sbx: Sandbox, label: string, cmd: string): Promise<void> {
  try {
    const result = await sbx.commands.run(cmd)
    if (result.exitCode !== 0) {
      throw new Error([
        `[artifact:${label}] exit=${result.exitCode}`,
        result.stderr ? `stderr=${result.stderr.trim()}` : '',
        result.stdout ? `stdout=${result.stdout.trim()}` : '',
      ].filter(Boolean).join(' '))
    }
  } catch (err) {
    throw new Error(`[artifact:${label}] ${(err as Error).message}`)
  }
}

async function extractZipUrlToPath(
  sbx: Sandbox,
  url: string,
  targetPath: string,
  label: string,
): Promise<void> {
  const script = [
    'python3 - <<\'PY\'',
    'import io, os, urllib.request, zipfile',
    `url = ${pyString(url)}`,
    `target = ${pyString(targetPath)}`,
    'os.makedirs(target, exist_ok=True)',
    'data = urllib.request.urlopen(url, timeout=60).read()',
    'with zipfile.ZipFile(io.BytesIO(data)) as zf:',
    '    zf.extractall(target)',
    'print("ok")',
    'PY',
  ].join('\n')
  await runSandboxCommand(sbx, label, script)
}

function designSystemZipUrl(id: string): string {
  return `${ARTIFACT_BASE_URL}/design-systems/${id}.zip`
}

function buildingSkillZipUrl(id: string): string {
  return `${ARTIFACT_BASE_URL}/building-skills/${id}.zip`
}

function skillZipUrl(slug: string): string {
  return `${ARTIFACT_BASE_URL}/skills/${slug}.zip`
}

export function hostedSkillSlug(raw: string): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/github:rebyteai\/rebyte-skills#(.+)$/)
  return (match?.[1] ?? trimmed).trim()
}

export async function installHostedDesignSystem(opts: {
  userId: string
  projectId: string
  id: string
}): Promise<void> {
  const sbx = await connectProjectSandbox(opts.userId, opts.projectId)
  await extractZipUrlToPath(sbx, designSystemZipUrl(opts.id), PROJECT_ROOT, `design-system:${opts.id}`)
}

export async function installHostedBuildingSkill(opts: {
  userId: string
  projectId: string
  id: string
}): Promise<void> {
  const sbx = await connectProjectSandbox(opts.userId, opts.projectId)
  await extractZipUrlToPath(sbx, buildingSkillZipUrl(opts.id), SANDBOX_SKILLS_ROOT, `building-skill:${opts.id}`)
}

export async function installHostedSkill(opts: {
  userId: string
  projectId: string
  slug: string
}): Promise<void> {
  const sbx = await connectProjectSandbox(opts.userId, opts.projectId)
  await extractZipUrlToPath(sbx, skillZipUrl(opts.slug), SANDBOX_SKILLS_ROOT, `skill:${opts.slug}`)
}

export async function installHostedSkills(opts: {
  userId: string
  projectId: string
  skills: string[]
}): Promise<void> {
  for (const raw of opts.skills) {
    const slug = hostedSkillSlug(raw)
    if (!slug) continue
    await installHostedSkill({ userId: opts.userId, projectId: opts.projectId, slug })
  }
}
