# One-pager

Produce a single-page document that summarizes the subject at a glance — readable in under a minute, scannable in thirty seconds.

## Variant & orientation

Variants: exec summary / product brief / proposal / case study / event flyer / team dossier. Default: exec summary.

Orientation: portrait (default) or landscape. Paper: Letter (North American) / A4 otherwise.

## Structure

Pick the combination for the variant. **Bold** = required. Reading order is top-to-bottom, left-to-right. Any required section that would be a single bullet → merge or drop.

| Section | Contents | Length |
|---|---|---|
| **Title block** | Subject name, one-line subtitle, optional logo, optional date | 3–5 lines |
| TL;DR (recommended) | One or two sentences that carry the whole document | ≤ 40 words |
| Problem / Opportunity | Why this matters to the reader | 2–4 short paragraphs or 3–5 bullets |
| Approach / Solution | What the subject does about it | 2–4 short paragraphs or 3–5 bullets |
| Metrics / Outcomes | Cards, stat blocks, or a row of numbers | 3–5 items |
| Supporting quote | One short quote with attribution | ≤ 20 words |
| Visual anchor | One image, chart, or diagram — never two | proportional |
| **Next step / CTA** | Concrete action, audience, contact | 1–2 lines |
| Signature line | Author, date, contact | 1 line |

## Writing rules

- **Headline does the work.** Title + subtitle must let a reader decide "keep reading" or "skip" in three seconds.
- **TL;DR is not optional for long subjects.** One line that a reader can stop at and still get the point.
- **Numbers beat adjectives.** `Grew MRR 2.4×` beats `significant revenue growth`.
- **Scan-first for external audiences.** Bullets and stat cards over paragraphs. Paragraphs OK for narrative exec summaries.
- **One visual anchor max.** Two competing visuals split the eye; cut to one.
- **Accent discipline.** Accent on the headline, one stat card, and the CTA. Not every heading or bullet.
- **Distinctive phrasing.** Cut "best-in-class," "world-class," "next-generation," "seamless," "cutting-edge."
- **Consistent voice.** Third-person for external, first-person plural for internal. Pick one and hold.

## Source & material

One-pagers die from vague claims.

- **Every named entity or metric** (company, product, person, date, launch, funding, revenue, user count, percentage) must come from user-supplied material. Check primary sources (official site, docs, filings, release notes) when available.
- **No invented percentages, dollar figures, dates, or versions.**
- **Required items present**: subject name + one-line description; at least one concrete metric or outcome for results-oriented variants; logo for branded one-pagers; contact line for external-facing. If missing, produce a gap table and ask once.

## Distill raw input

Skip if the user handed over structured content (headline + sections + data in place).

If raw:

1. Extract every claim, number, date, quote, name, logo/screenshot reference.
2. Classify: Title / TL;DR / Problem / Approach / Metrics / Supporting Quote / CTA.
3. Gap-check — which sections are empty? Is there at least one quantifiable outcome?
4. Ask once with a gap table.

## Form-specific verification

Beyond `done` + `fork_verifier_agent`:

- **One page** at chosen paper + orientation. Print preview confirms.
- **Thirty-second skim test.** If a reader only looks at headline + TL;DR + stat cards + CTA, do they get the point? If not, rewrite headline or TL;DR.
- **Facts** — every number, name, date matches source.
- **Accent discipline** — accent color on ≤ 3 elements.
- **Visual anchor count** — exactly 0 or 1, never 2.

If a diagram is needed, extract the SVG from `.skills/design-systems/<id>/assets/diagrams/<type>.html` if present and drop into a `<figure>`. Don't invent diagram geometry when a primitive exists.

## Feedback protocol

| User says | Ask |
|---|---|
| "too dense" | Section spacing is X. Loosen, or cut [section Y]? |
| "doesn't land" | Headline is "[quote]." Sharpen to [A] or rewrite TL;DR [B]? |
| "looks generic" | Which axis — typography (hierarchy), accent discipline, or wording (clichés)? |
| "hierarchy unclear" | H1 size X / weight Y. Bump H1, add accent on TL;DR, or add whitespace above sections? |
| "too much color" | Accent is on A, B, C, D. Restrict to just the headline + CTA? |

Never say *"I'll adjust the hierarchy"* without naming the property and new value.

## When not to use

- Multi-page proposal / report → long-document skill.
- Résumé → `resume`. Slide deck → `slide-deck`. Interactive → `prototype`.
