import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { DESIGN_SYSTEMS } from '../packages/shared/design-systems.js'
import { BUILDING_SKILLS } from '../packages/shared/building-skills.js'
import { SKILLS } from '../packages/shared/skills.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const DESIGN_SYSTEMS_DIR = resolve(REPO_ROOT, 'server', 'backend', 'local', 'design-systems')
const BUILDING_SKILLS_DIR = resolve(REPO_ROOT, 'server', 'backend', 'local', 'building-skills')
const REBYTE_SKILLS_DIR = resolve(REPO_ROOT, '..', 'rebyte-skills')
const OUT_ROOT = resolve(REPO_ROOT, 'hosted-artifacts')

async function addDirToZip(
  zip: JSZip,
  hostDir: string,
  pathPrefix = '',
  rename?: (relativePath: string) => string,
): Promise<void> {
  const entries = await readdir(hostDir, { withFileTypes: true })
  for (const entry of entries) {
    const child = join(hostDir, entry.name)
    const relativePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await addDirToZip(zip, child, relativePath, rename)
      continue
    }
    if (!entry.isFile()) continue
    const zipPath = rename ? rename(relativePath) : relativePath
    zip.file(zipPath, await readFile(child))
  }
}

async function writeZip(zip: JSZip, outPath: string): Promise<void> {
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, bytes)
}

async function buildDesignSystems(): Promise<void> {
  for (const spec of DESIGN_SYSTEMS) {
    const srcDir = join(DESIGN_SYSTEMS_DIR, spec.id)
    const impeccable = join(srcDir, 'impeccable.md')
    const impeccableStat = await stat(impeccable).catch(() => null)
    if (!impeccableStat?.isFile()) {
      throw new Error(`Missing design system source: ${impeccable}`)
    }

    const zip = new JSZip()
    zip.file('.impeccable.md', await readFile(impeccable))

    const assetsDir = join(srcDir, 'assets')
    const assetsStat = await stat(assetsDir).catch(() => null)
    if (assetsStat?.isDirectory()) {
      await addDirToZip(zip, assetsDir, `.skills/design-systems/${spec.id}`)
    }

    await writeZip(zip, join(OUT_ROOT, 'design-systems', `${spec.id}.zip`))
  }
}

async function buildBuildingSkills(): Promise<void> {
  for (const spec of BUILDING_SKILLS) {
    const srcDir = join(BUILDING_SKILLS_DIR, spec.id)
    const srcStat = await stat(srcDir).catch(() => null)
    if (!srcStat?.isDirectory()) {
      throw new Error(`Missing building skill source: ${srcDir}`)
    }

    const zip = new JSZip()
    await addDirToZip(zip, srcDir, spec.id, relativePath =>
      relativePath.endsWith('/skill.md')
        ? relativePath.slice(0, -'skill.md'.length) + 'SKILL.md'
        : relativePath === 'skill.md'
          ? 'SKILL.md'
          : relativePath)

    await writeZip(zip, join(OUT_ROOT, 'building-skills', `${spec.id}.zip`))
  }
}

async function buildSkills(): Promise<void> {
  for (const spec of SKILLS) {
    const srcDir = join(REBYTE_SKILLS_DIR, spec.id)
    const srcStat = await stat(srcDir).catch(() => null)
    if (!srcStat?.isDirectory()) {
      throw new Error(`Missing hosted skill source: ${srcDir}`)
    }

    const zip = new JSZip()
    await addDirToZip(zip, srcDir, spec.id)
    await writeZip(zip, join(OUT_ROOT, 'skills', `${spec.id}.zip`))
  }
}

async function main(): Promise<void> {
  await rm(OUT_ROOT, { recursive: true, force: true })
  await buildDesignSystems()
  await buildBuildingSkills()
  await buildSkills()
  console.log(`Built hosted artifacts into ${OUT_ROOT}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
