## Design Context

### Users
<!-- Describe who this project is for. Who are they, what is their context, what job are they trying to get done? -->

### Brand Personality
<!-- Describe the voice and tone of this project in your own words. Three adjectives, a sentence, or a paragraph. Leave blank if you want the aesthetic alone to carry the brand. -->

### Aesthetic Direction

**Neobrutalism.** Raw, loud, unapologetic. Hard black borders, thick drop shadows, solid saturated colors, no gradients. The visual opposite of enterprise SaaS — every element is a *thing* with mass and edge. If kami is a whispered library, neobrutalism is a zine pinned to the wall.

- **Canvas:** Off-white `#FFFFFF` or a single pale color (`#FDFD96` pale yellow, `#B9E2F8` sky blue, `#FFC5C8` pale red). Never neutral gray. Pick one and commit.
- **Ink:** Pure black `#000000`. Every border, every text block, every outline. Non-negotiable — no gray borders, no `#333`, no `rgba(0,0,0,0.1)`. If it's a line, it's black.
- **Accents:** Solid saturated hex values. `#DC341E` red, `#FF5733` orange, `#0077B6` blue, `#40D39C` green, `#FDFD96` yellow, `#BC98CB` violet. Never faded, never tinted, never transparent. A button is either red or it's not.
- **Borders:** `2px solid #000` minimum on every interactive element and every surface. `3px` for primary actions. No rounded corners > `6px` — boxes are boxes.
- **Shadows:** Hard drop shadows only. `box-shadow: 4px 4px 0 #000` (or `6px 6px 0 #000` for emphasis). Offset, opaque, zero blur. Never soft, never elevated, never material.
- **Type:** A single bold sans — system `Inter`, `Space Grotesk`, or `Arial Black`. Weight 600-900 for headings, 400-500 for body. Generous letter-spacing on headings is fine; caps are encouraged for section labels.
- **Mono:** `JetBrains Mono` or `Space Mono` — used liberally for codes, labels, and anywhere a technical flavor helps.
- **Spacing:** Generous. Neobrutalism needs air around its heavy elements — tight spacing reads as cluttered. Min `16px` gaps, `24-32px` between sections.
- **Motion:** Snap, don't ease. Hover = `translate(-2px, -2px)` with shadow expanding to `6px 6px 0 #000`. Instant transitions (100ms linear), no cubic-bezier softness.

**References:** The source MIT library `NeoBrutalismCSS` (Matias Fandiño), neobrutalism.dev, old protest posters, riso-printed zines, early Jamaican dub album covers, brutalist architecture (Barbican, Trellick Tower).
**Anti-references:** Material Design, iOS glass / liquid-glass, Tailwind default grays, anything with `rgba()` shadows, subtle hover states, "elegant" in any sense.

### Document Templates

This design system ships CSS tokens and utility classes only — no document templates. Building skills should generate structure from scratch following the rules above, then link the vendored stylesheet:

```html
<link rel="stylesheet" href=".skills/design-systems/neobrutalism/dist/index.min.css">
```

Reference component demos live at `.skills/design-systems/neobrutalism/docs/docs.html` — open them to see what canonical neobrutalism surfaces (buttons, cards, dialogs, inputs) look like, and mirror those patterns.

### Design Principles

1. **Mass over subtlety.** Every element should feel heavy. If it could be mistaken for a disabled state, it's too light.

2. **Commit to the color.** Neobrutalism works with 1-3 solid hues maximum. Don't hedge with 10% opacity, don't "soften" for accessibility — pick the color and let it be loud. Black text on saturated backgrounds is the pattern.

3. **Borders over backgrounds for hierarchy.** Want to separate two things? Put a 2px black line between them. Don't reach for a new background tint — the palette is too loud for nested color layering to read.

4. **Snap, never fade.** Motion is binary: on, off. No easing functions, no long durations. The aesthetic is "clicky," not "fluid."

<!-- Add project-specific principles below. -->
