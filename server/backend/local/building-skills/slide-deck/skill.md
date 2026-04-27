# Slide deck

Produce a presentation as a single HTML document.

**Always use `copy_starter_component({kind: "deck_stage.js"})` as the shell**, per system.md § Fixed-size content. The component handles scaling, keyboard/tap navigation, the slide-count overlay, `{slideIndexChanged}` postMessage, localStorage persistence, and print-to-PDF. Each slide goes as a direct child `<section>` of the `<deck-stage>` element.

## Variant & shape

Variants: pitch / report-out / technical walkthrough / keynote / training / status update. Default: report-out.

Aspect ratio: 16:9 default, 4:3 on request. Length buckets: short (≤ 10), medium (11–20), long (> 20). Long decks need section dividers and may use a design-system Deck Recipe if the contract names one.

## Structure

### Slide inventory

| Slide type | Purpose | How many |
|---|---|---|
| **Cover** | Title, subtitle, presenter, date | 1 |
| Section divider (long decks) | Section name, large type, accent | 1 per section |
| **Content slides** | One idea per slide. Strong anchor: number, quote, chart, image, or short bullet list (≤ 5) | most |
| Transition | One short phrase that sets up the next section | optional, rare |
| **Closing** | Summary, ask, or contact. Mirrors cover. | 1 |
| Appendix | Backup data — reached via jump-nav, not main sequence | optional |

### Per-slide zones

- **Header** — slide title or section eyebrow. Short.
- **Body** — one idea. One visual anchor max.
- **Footer (optional)** — page number, brand mark, section label. Subtle.

Keep zones consistent across the deck so the eye doesn't re-learn the layout.

## Writing rules

- **One idea per slide.** If a slide has a paragraph, it's two slides.
- **Words are anchors, not narration.** ≤ 30 words per content slide; ≤ 10 on headline-style slides.
- **Numbers are the strongest anchor.** One large number + one-line context beats three bullets.
- **Every slide earns its place.** Cut slides that paraphrase their neighbors.
- **Accent discipline.** Cover + section dividers + closing + occasional stat callout. Not on every slide header.
- **Quote attribution on the same slide** as the quote.
- **Consistent tense and voice.** Past for things that happened, present for things that are. Pick and hold.
- **Distinctive over clichéd.** Cut "our journey," "unleashing," "best-in-class," "transform."
- **Label each slide with `data-screen-label="NN Title"`** (1-indexed) per system.md § Labelling slides.

## Source & material

- **Every named entity, metric, quote, or attribution** from user-supplied material.
- **No fabricated percentages, dollar figures, dates, versions, or quote sources.**
- **Required items present**: title + presenter (cover), brand logo (branded decks), metrics (pitch/report-out/case study), quote attributions, screenshots (product/technical). If missing, produce a gap table and ask once.

## Distill raw input

Slides start with **story**, not layout.

1. Extract thesis, evidence, metrics, quotes, action items, visual assets.
2. **Sketch the arc** in one line each:
   - Pitch: Problem → Market → Solution → Traction → Ask
   - Report-out: Goals → What shipped → Metrics → Learnings → Next
3. Estimate slide count (~1–3 slides per arc beat).
4. Gap-check which beats have no supporting fact or visual.
5. Ask once with a gap table.

## Form-specific verification

Beyond `done` + `fork_verifier_agent`:

- **Keyboard nav works** — arrows, space, Home, End — current slide index updates (deck_stage handles it; confirm not broken).
- **No slide overflows the viewport** at chosen aspect on 1440×900.
- **Word budget honored** — no content slide exceeds ~30 words.
- **Accent discipline** — ≤ 4 slide roles use accent.
- **Every slide earns its place** — skim for paraphrase-of-neighbor.
- **Facts** — every number, name, date, quote, attribution matches source material.
- **Print path** renders cleanly as sequential pages with no nav chrome (`@media print`).

Speaker notes only if the user asked (system.md § Speaker notes).

## Feedback protocol

| User says | Ask |
|---|---|
| "too many slides" | Deck is N slides, arc is [A → B → C]. Cut [section X], or merge slides [Y and Z]? |
| "slide too busy" | Slide N has k elements, w words. Drop [element], split, or tighten copy? |
| "boring" | Which axis — pacing (too uniform), typography (no hierarchy), or story (unclear arc)? Pick one. |
| "doesn't flow" | Arc goes [X → Y → Z]. Add a transition between [X] and [Y], or resequence? |
| "colors feel loud" | Accent is on [list]. Restrict to [shorter list]? |

Never say *"I'll tighten the deck"* without naming the slide and the change.

## When not to use

- Static handout / read-aloud → `one-pager` or long-document.
- Interactive navigation with state → `prototype`.
- Single marketing poster → `one-pager` landscape.
