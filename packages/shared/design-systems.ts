/**
 * The hardcoded list of design systems a project can adopt. The id is the
 * stable key — it matches the directory name under
 * `server/backend/local/design-systems/<id>/` in local mode, and maps to a
 * different resolution path in rebyte mode (out of scope here).
 *
 * Adding a new design system is a two-step change: (1) add an entry to
 * `DESIGN_SYSTEMS`, (2) create the corresponding content directory on disk.
 * Both must be present — there is no default, no fallback.
 */

export interface DesignSystemSpec {
  id: string
  label: string
  description: string
  preview: DesignSystemPreviewSpec
  /** Optional grouping label for the picker. When absent, the entry falls
   *  into the Starter group at the bottom of the dropdown. The literal
   *  value is the visible group heading; keep the same string across
   *  entries that should group together. */
  category?: string
}

export interface DesignSystemPreviewSpec {
  pattern: 'editorial' | 'product' | 'glow' | 'brutal'
  canvas: string
  panel: string
  panelAlt: string
  ink: string
  accent: string
  accentSoft: string
  radius: string
}

function preview(
  pattern: DesignSystemPreviewSpec['pattern'],
  canvas: string,
  panel: string,
  panelAlt: string,
  ink: string,
  accent: string,
  accentSoft: string,
  radius: string,
): DesignSystemPreviewSpec {
  return { pattern, canvas, panel, panelAlt, ink, accent, accentSoft, radius }
}

export const DESIGN_SYSTEMS: readonly DesignSystemSpec[] = [
  {
    id: 'kami',
    label: 'Kami',
    description: 'Warm parchment, ink-blue accent, editorial serif — good content deserves good paper',
    preview: preview('editorial', '#f4efe6', '#fbf7ef', '#e8dfcf', '#22324a', '#56729f', '#d9c6a2', '20px'),
  },
  {
    id: 'corporate-memo',
    label: 'Corporate memo',
    description: 'Cool neutrals, sans-serif, navy accent, rule lines not shadows — density is respect',
    preview: preview('editorial', '#eef2f5', '#ffffff', '#e2e8ef', '#223042', '#39597c', '#c7d3df', '10px'),
  },
  {
    id: 'neobrutalism',
    label: 'Neobrutalism',
    description: 'Hard black borders, solid saturated color, offset drop shadows — raw and loud',
    preview: preview('brutal', '#fee95d', '#fffbf1', '#ff6b3d', '#111111', '#2f6bff', '#ff4db8', '0px'),
  },

  // Imported from open-design via scripts/import-od-design-systems.ts.
  // Original source: VoltAgent/awesome-design-md (MIT). Aesthetic
  // inspirations only — none are official assets of the brands referenced.
  {
    id: 'linear-app',
    label: 'Linear',
    description: 'Project management. Ultra-minimal, precise, purple accent.',
    category: 'Productivity & SaaS',
    preview: preview('glow', '#0d0d12', '#171720', '#20202d', '#f5f3ff', '#8b5cf6', '#312e81', '18px'),
  },
  {
    id: 'vercel',
    label: 'Vercel',
    description: 'Frontend deployment. Black and white precision, Geist font.',
    category: 'Developer Tools',
    preview: preview('product', '#ffffff', '#ffffff', '#f2f2f2', '#111111', '#111111', '#d8d8d8', '14px'),
  },
  {
    id: 'stripe',
    label: 'Stripe',
    description: 'Payment infrastructure. Signature purple gradients, weight-300 elegance.',
    category: 'Fintech & Crypto',
    preview: preview('glow', '#f6f7fb', '#ffffff', '#eef0ff', '#2d2a5a', '#635bff', '#c4b5fd', '20px'),
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'All-in-one workspace. Warm minimalism, serif headings, soft surfaces.',
    category: 'Productivity & SaaS',
    preview: preview('editorial', '#faf9f7', '#ffffff', '#f1efeb', '#2f2d2a', '#8b7f6f', '#ddd7ce', '16px'),
  },
  {
    id: 'supabase',
    label: 'Supabase',
    description: 'Open-source Firebase alternative. Dark emerald theme, code-first.',
    category: 'Backend & Data',
    preview: preview('glow', '#0b0f0c', '#111615', '#18211d', '#e8f7ef', '#3ecf8e', '#124a34', '16px'),
  },
  {
    id: 'figma',
    label: 'Figma',
    description: 'Collaborative design tool. Vibrant multi-color, playful yet professional.',
    category: 'Design & Creative',
    preview: preview('product', '#f7f7f7', '#ffffff', '#f1f1f1', '#111111', '#7b61ff', '#ff7262', '18px'),
  },
  {
    id: 'intercom',
    label: 'Intercom',
    description: 'Customer messaging. Friendly blue palette, conversational UI patterns.',
    category: 'Productivity & SaaS',
    preview: preview('product', '#f5f9ff', '#ffffff', '#e9f0fb', '#1f3b63', '#1f8fff', '#bcdcff', '18px'),
  },
  {
    id: 'superhuman',
    label: 'Superhuman',
    description: 'Fast email client. Premium dark UI, keyboard-first, purple glow.',
    category: 'Developer Tools',
    preview: preview('glow', '#111016', '#1a1922', '#232033', '#f6f0ff', '#9b6bff', '#463180', '18px'),
  },
  {
    id: 'mintlify',
    label: 'Mintlify',
    description: 'Documentation platform. Clean, green-accented, reading-optimized.',
    category: 'Productivity & SaaS',
    preview: preview('product', '#fbfffd', '#ffffff', '#eef8f2', '#183424', '#18e299', '#baf5da', '16px'),
  },
  {
    id: 'posthog',
    label: 'PostHog',
    description: 'Product analytics. Playful hedgehog branding, developer-friendly dark UI.',
    category: 'Backend & Data',
    preview: preview('glow', '#161211', '#221c1a', '#2e2420', '#fff4ec', '#f97316', '#6b3416', '16px'),
  },
  {
    id: 'claude',
    label: 'Claude',
    description: "Anthropic's AI assistant. Warm terracotta accent, clean editorial layout.",
    category: 'AI & LLM',
    preview: preview('editorial', '#f7f2ea', '#fdf9f4', '#ece1d4', '#35261f', '#c46f4d', '#e6b49b', '18px'),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    description: 'AI-first code editor. Sleek dark interface, gradient accents.',
    category: 'Developer Tools',
    preview: preview('glow', '#0e1014', '#171b22', '#1e2530', '#eef4ff', '#4f8cff', '#31446f', '16px'),
  },
  {
    id: 'raycast',
    label: 'Raycast',
    description: 'Productivity launcher. Sleek dark chrome, vibrant gradient accents.',
    category: 'Developer Tools',
    preview: preview('glow', '#101014', '#191923', '#242433', '#f5f4ff', '#ff6363', '#6b4dd6', '18px'),
  },
  {
    id: 'warp',
    label: 'Warp',
    description: 'Modern terminal. Dark IDE-like interface, block-based command UI.',
    category: 'Developer Tools',
    preview: preview('glow', '#0d1018', '#141a26', '#1c2432', '#eaf0ff', '#7c8cff', '#38486f', '14px'),
  },
  {
    id: 'apple',
    label: 'Apple',
    description: 'Consumer electronics. Premium white space, SF Pro, cinematic imagery.',
    category: 'Media & Consumer',
    preview: preview('product', '#f5f5f7', '#ffffff', '#ececef', '#1d1d1f', '#6e6e73', '#d7d7dc', '22px'),
  },
  {
    id: 'airbnb',
    label: 'Airbnb',
    description: 'Travel marketplace. Warm coral accent, photography-driven, rounded UI.',
    category: 'E-Commerce & Retail',
    preview: preview('product', '#fff8f7', '#ffffff', '#ffeceb', '#34231e', '#ff5a5f', '#ffc9cb', '22px'),
  },
  {
    id: 'framer',
    label: 'Framer',
    description: 'Website builder. Bold black and blue, motion-first, design-forward.',
    category: 'Design & Creative',
    preview: preview('glow', '#0a0b12', '#11131d', '#1a2240', '#eef4ff', '#295cff', '#5ecbff', '16px'),
  },
  {
    id: 'spotify',
    label: 'Spotify',
    description: 'Music streaming. Vibrant green on dark, bold type, album-art-driven.',
    category: 'Media & Consumer',
    preview: preview('glow', '#0b0d0b', '#121512', '#1b211b', '#f6fff6', '#1ed760', '#0e5a28', '18px'),
  },
  {
    id: 'wired',
    label: 'WIRED',
    description: 'Tech magazine. Paper-white broadsheet density, custom serif display, mono kickers, ink-blue links.',
    category: 'Media & Consumer',
    preview: preview('editorial', '#f9f8f4', '#ffffff', '#eff1f4', '#14263f', '#1c5aa6', '#cfd9e8', '8px'),
  },
  {
    id: 'xiaohongshu',
    label: 'Xiaohongshu',
    description: 'Lifestyle UGC social platform. Singular brand red, generous radius, content-first.',
    category: 'Media & Consumer',
    preview: preview('product', '#fff7f8', '#ffffff', '#ffecee', '#2d2021', '#ff2442', '#ffc7d1', '22px'),
  },
]

export type DesignSystemId = (typeof DESIGN_SYSTEMS)[number]['id']

export function getDesignSystem(id: string): DesignSystemSpec | null {
  return DESIGN_SYSTEMS.find(d => d.id === id) ?? null
}
