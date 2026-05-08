import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import type { Sandbox } from 'rebyte-sandbox'
import { connectProjectSandbox } from './sandbox.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const LOCAL_DESIGN_SYSTEMS_DIR = resolve(REPO_ROOT, 'server', 'backend', 'local', 'design-systems')
const LOCAL_BUILDING_SKILLS_DIR = resolve(REPO_ROOT, 'server', 'backend', 'local', 'building-skills')
const REBYTE_SKILLS_DIR = resolve(REPO_ROOT, '..', 'rebyte-skills')
const PROJECT_ROOT = '/code'
const SANDBOX_SKILLS_DIR = '/home/user/.skills'

function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function addDirToZip(folder: JSZip, hostDir: string): Promise<void> {
  const entries = await readdir(hostDir, { withFileTypes: true })
  for (const entry of entries) {
    const child = join(hostDir, entry.name)
    if (entry.isDirectory()) {
      const sub = folder.folder(entry.name)
      if (sub) await addDirToZip(sub, child)
    } else if (entry.isFile()) {
      folder.file(entry.name, await readFile(child))
    }
  }
}

async function addDirToZipWithTransform(
  folder: JSZip,
  hostDir: string,
  transformName: (relativePath: string) => string,
  relativePrefix = '',
): Promise<void> {
  const entries = await readdir(hostDir, { withFileTypes: true })
  for (const entry of entries) {
    const child = join(hostDir, entry.name)
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await addDirToZipWithTransform(folder, child, transformName, relativePath)
    } else if (entry.isFile()) {
      folder.file(transformName(relativePath), await readFile(child))
    }
  }
}

async function zipDirectoryContents(hostDir: string): Promise<Uint8Array> {
  const hostStat = await stat(hostDir).catch(() => null)
  if (!hostStat?.isDirectory()) {
    throw new Error(`artifact source dir missing: ${hostDir}`)
  }
  const zip = new JSZip()
  await addDirToZip(zip, hostDir)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function zipBuildingSkill(id: string): Promise<Uint8Array> {
  const srcDir = join(LOCAL_BUILDING_SKILLS_DIR, id)
  const srcStat = await stat(srcDir).catch(() => null)
  if (!srcStat?.isDirectory()) {
    throw new Error(`building skill source dir missing: ${srcDir}`)
  }
  const zip = new JSZip()
  await addDirToZipWithTransform(zip, srcDir, relativePath => relativePath === 'skill.md' ? 'SKILL.md' : relativePath)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function zipDesignSystem(id: string): Promise<Uint8Array> {
  const srcDir = join(LOCAL_DESIGN_SYSTEMS_DIR, id)
  const impeccableSrc = join(srcDir, 'impeccable.md')
  const impeccableStat = await stat(impeccableSrc).catch(() => null)
  if (!impeccableStat?.isFile()) {
    throw new Error(`design system source missing: ${impeccableSrc}`)
  }
  const zip = new JSZip()
  zip.file('impeccable.md', await readFile(impeccableSrc))
  const assetsDir = join(srcDir, 'assets')
  const assetsStat = await stat(assetsDir).catch(() => null)
  if (assetsStat?.isDirectory()) {
    const assets = zip.folder('assets')
    if (assets) await addDirToZip(assets, assetsDir)
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function addGitHubDirToZip(
  zip: JSZip,
  owner: string,
  repo: string,
  dirPath: string,
  relativePrefix = '',
): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'adits-artifact-installer',
    },
  })
  if (!res.ok) {
    throw new Error(`GitHub contents fetch failed for ${dirPath}: ${res.status} ${res.statusText}`)
  }
  const entries = await res.json() as Array<{
    type: 'file' | 'dir'
    name: string
    path: string
    download_url: string | null
  }>
  for (const entry of entries) {
    const nextRelative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
    if (entry.type === 'dir') {
      await addGitHubDirToZip(zip, owner, repo, entry.path, nextRelative)
      continue
    }
    if (entry.type === 'file' && entry.download_url) {
      const fileRes = await fetch(entry.download_url, {
        headers: { 'User-Agent': 'adits-artifact-installer' },
      })
      if (!fileRes.ok) {
        throw new Error(`GitHub file fetch failed for ${entry.path}: ${fileRes.status} ${fileRes.statusText}`)
      }
      const bytes = new Uint8Array(await fileRes.arrayBuffer())
      zip.file(nextRelative, bytes)
    }
  }
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

async function uploadAndExtractToPath(
  sbx: Sandbox,
  zipBytes: Uint8Array,
  targetPath: string,
  label: string,
): Promise<void> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmpZip = `/tmp/adits-${label}-${stamp}.zip`
  const tmpDir = `/tmp/adits-${label}-${stamp}`
  const ab = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer
  await sbx.files.write(tmpZip, ab)
  const cmd = [
    'set -e',
    `rm -rf ${sh(tmpDir)}`,
    `mkdir -p ${sh(tmpDir)} ${sh(dirname(targetPath))}`,
    `unzip -oq ${sh(tmpZip)} -d ${sh(tmpDir)}`,
    `rm -rf ${sh(targetPath)}`,
    `mkdir -p ${sh(targetPath)}`,
    `cp -R ${sh(`${tmpDir}/.`)} ${sh(`${targetPath}/`)}`,
    `rm -rf ${sh(tmpZip)} ${sh(tmpDir)}`,
  ].join(' && ')
  await runSandboxCommand(sbx, label, cmd)
}

async function uploadAndApplyDesignSystem(
  sbx: Sandbox,
  id: string,
  zipBytes: Uint8Array,
): Promise<void> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmpZip = `/tmp/adits-design-${id}-${stamp}.zip`
  const tmpDir = `/tmp/adits-design-${id}-${stamp}`
  const dstAssets = `${PROJECT_ROOT}/.skills/design-systems/${id}`
  const ab = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer
  await sbx.files.write(tmpZip, ab)
  const cmd = [
    'set -e',
    `rm -rf ${sh(tmpDir)}`,
    `mkdir -p ${sh(tmpDir)} ${sh(PROJECT_ROOT)} ${sh(dstAssets)}`,
    `unzip -oq ${sh(tmpZip)} -d ${sh(tmpDir)}`,
    `cp ${sh(`${tmpDir}/impeccable.md`)} ${sh(`${PROJECT_ROOT}/.impeccable.md`)}`,
    `rm -rf ${sh(dstAssets)}`,
    `mkdir -p ${sh(dstAssets)}`,
    `if [ -d ${sh(`${tmpDir}/assets`)} ]; then cp -R ${sh(`${tmpDir}/assets/.`)} ${sh(`${dstAssets}/`)}; fi`,
    `rm -rf ${sh(tmpZip)} ${sh(tmpDir)}`,
  ].join(' && ')
  await runSandboxCommand(sbx, `design-system:${id}`, cmd)
}

function hostedSkillSourceDir(id: string): string {
  return join(REBYTE_SKILLS_DIR, id)
}

async function zipHostedSkill(slug: string): Promise<Uint8Array> {
  const localDir = hostedSkillSourceDir(slug)
  const localStat = await stat(localDir).catch(() => null)
  if (localStat?.isDirectory()) {
    return zipDirectoryContents(localDir)
  }

  const zip = new JSZip()
  await addGitHubDirToZip(zip, 'ReByteAI', 'rebyte-skills', slug)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
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
  const zip = await zipDesignSystem(opts.id)
  const sbx = await connectProjectSandbox(opts.userId, opts.projectId)
  await uploadAndApplyDesignSystem(sbx, opts.id, zip)
}

export async function installHostedBuildingSkill(opts: {
  userId: string
  projectId: string
  id: string
}): Promise<void> {
  const zip = await zipBuildingSkill(opts.id)
  const sbx = await connectProjectSandbox(opts.userId, opts.projectId)
  await uploadAndExtractToPath(sbx, zip, `${SANDBOX_SKILLS_DIR}/${opts.id}`, `building-skill-${opts.id}`)
}

export async function installHostedSkill(opts: {
  userId: string
  projectId: string
  slug: string
}): Promise<void> {
  const zip = await zipHostedSkill(opts.slug)
  const sbx = await connectProjectSandbox(opts.userId, opts.projectId)
  await uploadAndExtractToPath(sbx, zip, `${SANDBOX_SKILLS_DIR}/${opts.slug}`, `skill-${opts.slug}`)
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
