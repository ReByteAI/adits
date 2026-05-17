/**
 * One-shot importer: pulls a curated subset of design systems from the
 * adjacent open-design repo (which itself sources them from VoltAgent's
 * awesome-design-md / npm `getdesign`, MIT-licensed) and emits adits-shaped
 * `impeccable.md` files under `server/backend/local/design-systems/<id>/`.
 *
 * The OD `DESIGN.md` body (its 9 sections — Visual Theme / Color / Typography
 * / Components / Layout / Depth / Do&Don't / Responsive / Agent Prompt Guide)
 * is preserved verbatim. We prepend the adits 5-section header (Users /
 * Brand Personality / Aesthetic Direction / Design Principles) so the file
 * still answers what `system.md` expects to read first.
 *
 * Usage (from /code/adits):
 *   node --experimental-strip-types scripts/import-od-design-systems.ts
 *
 * Re-running is idempotent (overwrites the destination files). After running,
 * paste the registry block printed at the end into
 * `packages/shared/design-systems.ts`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const OD_SRC = '/code/open-design/design-systems'
const ADITS_DST = resolve(REPO_ROOT, 'server/backend/local/design-systems')

interface Target {
  id: string
  label: string
}

const TARGETS: readonly Target[] = [
  { id: 'linear-app', label: 'Linear' },
  { id: 'vercel', label: 'Vercel' },
  { id: 'stripe', label: 'Stripe' },
  { id: 'notion', label: 'Notion' },
  { id: 'supabase', label: 'Supabase' },
  { id: 'figma', label: 'Figma' },
  { id: 'intercom', label: 'Intercom' },
  { id: 'superhuman', label: 'Superhuman' },
  { id: 'mintlify', label: 'Mintlify' },
  { id: 'posthog', label: 'PostHog' },
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'raycast', label: 'Raycast' },
  { id: 'warp', label: 'Warp' },
  { id: 'apple', label: 'Apple' },
  { id: 'airbnb', label: 'Airbnb' },
  { id: 'framer', label: 'Framer' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'wired', label: 'WIRED' },
  { id: 'xiaohongshu', label: 'Xiaohongshu' },
]

const USERS_BY_CATEGORY: Record<string, string> = {
  'AI & LLM': 'AI product teams — conversational interfaces, model surfaces, developer-facing AI tools.',
  'Developer Tools': 'Engineers and technical decision-makers — IDEs, terminals, dev workflow tools.',
  'Productivity & SaaS': 'Product / SaaS teams — workflow tools, dashboards, B2B utility apps.',
  'Backend & Data': 'Engineering and data teams — observability, databases, backend platforms.',
  'Design & Creative': 'Designers and creative professionals — design tools, prototyping, creative software.',
  'Fintech & Crypto': 'Financial product teams — payments, banking, trust-driven UI.',
  'E-Commerce & Retail': 'Consumer brands and retail — marketplaces, storefronts, lifestyle products.',
  'Media & Consumer': 'Consumer brands and media — broad-audience marketing, brand sites, content publishing.',
  Automotive: 'Automotive marketing and product — vehicle pages, brand storytelling.',
}

interface Parsed {
  category: string
  summary: string
  body: string
}

function parse(md: string): Parsed {
  const lines = md.split('\n')
  let category = ''
  let summary = ''
  let bodyStart = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('> Category:')) {
      category = line.replace('> Category:', '').trim()
      continue
    }
    if (line.startsWith('> ') && category && !summary) {
      summary = line.slice(2).trim()
      continue
    }
    if (line.startsWith('## ')) {
      bodyStart = i
      break
    }
  }
  if (bodyStart === -1) throw new Error('no body sections found')
  const body = lines.slice(bodyStart).join('\n').trimEnd() + '\n'
  return { category, summary, body }
}

function makeImpeccable(p: Parsed): string {
  const users = USERS_BY_CATEGORY[p.category] ?? `${p.category} audiences.`
  return `## Design Context

### Users
${users}

### Brand Personality
${p.summary}

### Aesthetic Direction
See the sections below for the full token / typography / component spec — they are binding.

### Design Principles

1. **Do's and Don'ts are rules, not suggestions.** When tempted to deviate from the section below, don't.
2. **Pick weights and sizes from the typography table.** No new font sizes, no in-between weights.
3. **Accent discipline.** The chromatic palette is what makes this system recognizable; preserve its restraint and budget across every page.

<!-- Add project-specific principles below. -->

${p.body}`
}

interface RegistryEntry {
  id: string
  label: string
  description: string
  category: string
}

async function main(): Promise<void> {
  const registry: RegistryEntry[] = []

  for (const t of TARGETS) {
    const srcPath = join(OD_SRC, t.id, 'DESIGN.md')
    const md = await readFile(srcPath, 'utf8')
    const parsed = parse(md)
    if (!parsed.category) throw new Error(`${t.id}: no Category line`)
    if (!parsed.summary) throw new Error(`${t.id}: no summary line`)

    const out = makeImpeccable(parsed)
    const dstDir = join(ADITS_DST, t.id)
    await mkdir(dstDir, { recursive: true })
    await writeFile(join(dstDir, 'impeccable.md'), out)

    registry.push({
      id: t.id,
      label: t.label,
      description: parsed.summary,
      category: parsed.category,
    })

    const preview = parsed.summary.length > 60 ? parsed.summary.slice(0, 60) + '…' : parsed.summary
    console.log(`✓ ${t.id.padEnd(14)}  [${parsed.category.padEnd(22)}]  ${preview}`)
  }

  console.log('\n=== Paste below the kami/corporate-memo/neobrutalism block in DESIGN_SYSTEMS ===\n')
  for (const r of registry) {
    console.log('  {')
    console.log(`    id: ${JSON.stringify(r.id)},`)
    console.log(`    label: ${JSON.stringify(r.label)},`)
    console.log(`    description: ${JSON.stringify(r.description)},`)
    console.log(`    category: ${JSON.stringify(r.category)},`)
    console.log('  },')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
