## Design Context

### Users
<!-- Describe who this project is for. Who are they, what is their context, what job are they trying to get done? -->

### Brand Personality
<!-- Describe the voice and tone of this project in your own words. Three adjectives, a sentence, or a paragraph. Leave blank if you want the aesthetic alone to carry the brand. -->

### Aesthetic Direction

**Corporate memo.** The aesthetic of a well-edited internal document — the kind that gets printed, stapled, and read in a meeting. Informational density over decoration. Nothing flamboyant, nothing playful, nothing that would embarrass you in a boardroom.

- **Canvas:** Cool off-white `#FAFBFC`, never warm parchment. Pure white (`#FFFFFF`) is also acceptable where the content itself needs to feel authoritative (tables, financial figures).
- **Accent:** Deep navy `#0F2B49` is the sole chromatic color, used sparingly for links, highlighted headings, and the thin rules that separate sections. No second accent. No tints. Under 3% coverage on any page.
- **Neutrals:** Cool gray palette (blue-gray undertone). `#1F2937` for body text, `#4B5563` for secondary, `#9CA3AF` for muted, `#E5E7EB` for rules. No warm/beige grays anywhere.
- **Sans:** Inter (or system sans-serif) for everything. Body, headings, tables, metadata. Weight 400 for body, 600 for section heads, 700 only for emphasis inside body. No lighter weights — this is not a lifestyle magazine.
- **Serif:** None by default. A single serif face (Charter, Source Serif) is acceptable for a title block or pull quote if the document warrants it, but never for body.
- **Mono:** JetBrains Mono for figures, codes, IDs, tabular numerics.
- **Line-height:** Tight. 1.15 for headings, 1.4 for body. Never 1.5+ — this aesthetic prizes density.
- **Structure:** Left-aligned. Section headers are ALL-CAPS or small-caps, 12px, letter-spaced `0.08em`. A single thin horizontal rule (`1px solid #E5E7EB`) under each major heading. Numbered sections where the content benefits (1., 1.1, 1.1.1).
- **Shadows:** None. Ever. Depth comes from rule lines and whitespace, not elevation. If something needs to feel "raised," make it a table with a thin border instead.
- **Tables:** First-class citizens. Left-aligned text, right-aligned numbers. Zebra striping with `#F3F4F6`. Thin rules between rows.
- **Rule lines:** Used liberally. Under section heads, between columns, above and below tables. Always 1px, always `#E5E7EB` (or `#D1D5DB` for emphasized rules).

**References:** The Economist (density + hierarchy), McKinsey internal memos (structure + restraint), Stripe Annual Letter (typography at scale), Apple 10-K filings (information design), Bloomberg Terminal (tabular confidence), the MIT-licensed `sakura.css` library (vendored below — classless typography foundation matches this aesthetic).
**Anti-references:** Canva templates, rounded "corporate friendly" illustrations, pastel palettes, gradient backgrounds, Notion cover images, anything that tries to "humanize" a business document.

### Document Templates

This design system ships CSS tokens only — no document templates. Building skills generate structure from scratch (following the rules above) and link the vendored Sakura palette as a classless typography baseline:

```html
<link rel="stylesheet" href=".skills/design-systems/corporate-memo/css/sakura-ink.css">
```

Sakura is **classless** — styling applies to semantic HTML (`h1`, `p`, `table`, `code`, `blockquote`) directly. Use `sakura-ink.css` for the default ink palette; other palettes (`sakura-earthly`, `sakura-vader`, etc.) are in the same directory if a project needs a variant. The Design Principles below still govern; Sakura is the typography foundation, not the brand.

### Design Principles

1. **Density is respect.** Assume the reader is busy and literate. White space separates sections; it does not pad paragraphs. A tight page signals "I edited this."

2. **No decoration, only information.** Every visual element must carry meaning — a rule separates sections, a bold word carries emphasis, a color marks a link. Nothing exists for mood.

3. **Tables are the highest art form.** When the content can be tabulated, tabulate it. A well-structured table beats three paragraphs of prose.

4. **Monochrome first.** Navy is a scalpel, used only where a human eye needs to find something. If a page has no navy, it's still correct.

<!-- Add project-specific principles below. -->
