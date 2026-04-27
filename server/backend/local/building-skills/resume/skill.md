# Resume

Produce a one-page CV or résumé as a single HTML document sized for A4 or US Letter.

## Structure

Order is fixed. **Bold** = required. Any required section that would be a single bullet → merge or drop.

| Section | Contents | Length |
|---|---|---|
| **Header** | Name, one-line role/focus, contact (email + 1–2 links), location | 2–4 lines |
| **Summary** | One or two sentences: what they do and for whom | ≤ 40 words |
| **Experience** | Reverse chronological. Per entry: role, company, location (opt), dates, 3–5 result-focused bullets | Fills the page |
| Projects | Only if Experience is thin or the role demands it | 2–4 entries |
| **Skills / Tools** | Grouped (Languages, Frameworks, Tools, …), not a wall of commas | 3–6 groups |
| Education | Degree, school, year. Relevant coursework only if junior | 1–2 lines / entry |
| Awards / Certifications | Title, issuer, year | 1 line / entry |

Default paper: Letter (North American audience) or A4 otherwise. No photo unless asked.

## Writing rules

- **One page.** Tighten prose first, trim weakest bullet second, reduce leading third. Never shrink type below the design system's body minimum.
- **Numbers beat adjectives.** *"Cut build time 40%"* beats *"responsible for improving build performance."*
- **Verbs lead bullets.** Shipped, built, led, cut, grew, reduced. Drop *"responsible for"* entirely.
- **Consistent tense.** Past for past roles; present only for the current role.
- **No first-person pronouns.** Bullets are imperative fragments, not sentences.
- **Consistent date format.** Pick `Jan 2022 – Present` or `2019–2022` and hold throughout.

## Source & material

Résumés die from invented facts.

- **Every claim** (company, title, date, metric) must come from user-supplied material. No inferred metrics, ever.
- **Required items present**: name, contact, company, dates, ≥1 metric per senior role. If missing, produce a compact gap table and ask once.

## Distill raw input

If the input is a brain dump or prior-format résumé:

1. Extract every claim, number, date, name, company, tool.
2. Classify into Header / Summary / Experience / Skills / Education / Awards.
3. Gap-check against the Structure table.
4. Ask once with a compact gap table.

## Form-specific verification

Beyond `done` + `fork_verifier_agent`:

- **One page** at chosen paper size. Use print preview.
- **Link sanity** — every link has a real `href`, no `#` stubs.
- **Section consistency** — bullet style, date format, and role/company order identical across entries.
- **Accent discipline** — accent on section headings at most, not on every bullet.

## Feedback protocol

When feedback is vague, name the property, state its value, propose two options inside the design contract.

| User says | Ask |
|---|---|
| "too cramped" | Line-height is X on body, Y on bullets. Tighten section padding (Xpx → Ypx) or increase bullet line-height (Y → Z)? |
| "too loose" | Same axes, reversed. |
| "hierarchy unclear" | H2 is size X / weight Y. Bump H2 size, add weight contrast, or add a rule between sections? |
| "doesn't feel premium" | Typography (font, tracking), whitespace (margin, leading), or alignment? Pick one axis. |

Never say *"I'll adjust the spacing"* without naming the property and new value.

## When not to use

- Multi-page CV / academic curriculum vitae with publications list → long-document path.
- Résumé as a deck or interactive portfolio → `slide-deck` or `prototype`.
- Heavily graphical / infographic résumé → typography-led; flag the mismatch and ask before producing.
