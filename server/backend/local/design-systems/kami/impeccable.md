## Design Context

### Users
<!-- Describe who this project is for. Who are they, what is their context, what job are they trying to get done? -->

### Brand Personality
<!-- Describe the voice and tone of this project in your own words. Three adjectives, a sentence, or a paragraph. Leave blank if you want the aesthetic alone to carry the brand. -->

### Aesthetic Direction

Ported from the [kami](https://github.com/tw93/kami) design language: *good content deserves good paper*. One visual idea — warm parchment, single ink accent, serif carries authority, editorial whitespace — applied consistently.

- **Canvas:** Parchment `#f5f4ed`, never pure white. Surfaces that sit on canvas go slightly lighter/creamier, never a cool gray.
- **Accent:** Ink blue `#1B365D` is the *only* chromatic color. No secondary hue, no gradients, no rose/magenta. Used for CTAs, active states, focus rings, links — and that's it.
- **Neutrals:** All warm-toned (yellow-brown undertone). No cool blue-grays anywhere in the palette.
- **Serif:** Newsreader, weight locked at **500**, never bold. The single-weight rule *is* the typographic signature — resist the urge to reach for 600/700 for emphasis; use size, color, or spacing instead.
- **Sans:** Inter for UI chrome and utility text.
- **Mono:** JetBrains Mono for file paths, code, IDs.
- **Line-height:** Tight titles 1.1–1.3, dense body 1.4–1.45, reading body 1.5–1.55. Never 1.6+.
- **Shadows:** Ring (1px warm-neutral border) or whisper (very soft, large-radius, low-alpha) only. No hard drop shadows, no material-style elevation.
- **Tags/chips:** Solid hex backgrounds only — avoid `rgba()` fills on chip-like elements.
- **Grain:** Subtle grain texture on the canvas — it reinforces "paper."

**References:** kami (the source), Linear (spacing precision), Apple first-party apps (restraint), Notion (structure), editorial print design (NYT, FT weekend, long-form magazines).
**Anti-references:** ChatGPT chat UIs, Canva's busy panels, AI-glow gradients, enterprise SaaS dashboards, neon accents, cool-gray Material palettes.

### Design Principles

1. **Calm over clever.** No gratuitous animation, no sparkle effects, no "magic" language. Motion is purposeful: reveals, transitions, progress.

2. **Premium means restraint.** Generous whitespace, minimal borders, whisper shadows, a single accent. If it doesn't serve clarity, remove it. When tempted to add a second color or a bolder weight — don't. Restraint *is* the signature.

3. **Typography carries the work.** A single serif weight does the job of headings, emphasis, and tone. Use size, color, and spacing for hierarchy instead of reaching for bold.

<!-- Add project-specific principles below. -->
