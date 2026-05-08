import type { Sandbox } from 'rebyte-sandbox'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectProjectSandbox } from './sandbox.js'

const ARTIFACT_BASE_URL = 'https://raw.githubusercontent.com/ReByteAI/adits/main/hosted-artifacts'
const PROJECT_ROOT = '/code'
const SANDBOX_SKILLS_ROOT = '/home/user/.skills'
const SANDBOX_SYSTEM_PROMPT_PATH = '/home/user/system_prompt.md'
const CORE_HOSTED_SKILLS = ['ask-design-questions'] as const

const __dirname = dirname(fileURLToPath(import.meta.url))
const SYSTEM_PROMPT_PATH = join(__dirname, '..', '..', '..', 'system.md')

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

export async function installHostedCoreSkills(opts: {
  userId: string
  projectId: string
}): Promise<void> {
  for (const slug of CORE_HOSTED_SKILLS) {
    await installHostedSkill({ userId: opts.userId, projectId: opts.projectId, slug })
  }
}

export async function syncHostedSystemPrompt(opts: {
  userId: string
  projectId: string
}): Promise<void> {
  const sbx = await connectProjectSandbox(opts.userId, opts.projectId)
  const prompt = await readFile(SYSTEM_PROMPT_PATH, 'utf8')
  const bytes = new TextEncoder().encode(prompt)
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  await sbx.files.write(SANDBOX_SYSTEM_PROMPT_PATH, ab)
}
