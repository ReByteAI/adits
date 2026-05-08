# Slide deck

Produce a **presentation deck**, not a web page.

This skill is the single source of truth for decks in Adits. If a user asks
for slides, a deck, a presentation, a keynote, a report-out, a board update,
or a pitch, this is the shape to follow.

## Hard contract

- **Always** call `copy_starter_component({kind: "deck_stage.js"})`.
- The final artifact **must** be a single HTML document.
- The shell **must** be `<deck-stage>`, with each slide as a direct child
  `<section>`.
- Slides **must** be labeled `data-screen-label="NN Title"` with 1-indexed
  numbering (`01`, `02`, ...).
- Default aspect ratio is **16:9**. Use 4:3 only if the user explicitly asks.
- **Do not** add speaker notes unless the user explicitly asks for them.

Why this is non-negotiable:
- `deck_stage.js` owns scaling, keyboard/tap nav, slide index, localStorage
  persistence, and print-to-PDF.
- The host depends on its `{slideIndexChanged: N}` postMessage and on the
  `data-screen-label` annotations for present mode, comments, and export.

If you hand-roll the shell, the deck is broken even if it looks good.

## What a deck is

A deck is a sequence of **high-signal frames** for live presentation.

It is **not**:
- a landing page chopped into sections
- a document with page breaks
- a stack of uniform cards
- a bullet dump
- a mini website with scrolling

Every slide should feel like a deliberate screen in a talk track. The viewer
should understand the arc even when flipping quickly.

## Default deck behavior

- One idea per slide.
- One visual anchor per slide.
- Titles are short, declarative, and specific.
- Body copy is sparse: anchors, not paragraphs.
- Keep rhythm: alternate dense and airy slides; do not make every slide use
  the same composition.
- Use accent sparingly. Cover, section divider, closer, and the occasional
  stat callout are enough.

## Word budget

- Cover: title + subtitle only.
- Headline/stat slides: **≤ 10 words**
- Standard content slides: **≤ 30 words**
- Bullet lists: **≤ 5 bullets**, and each bullet must be short.

If a slide wants a paragraph, split it into two slides.

## Slide archetypes

Use these as building blocks. A good deck uses 3–5 of them, not the same one
repeated over and over.

### 1. Cover
- Title
- subtitle / framing line
- presenter / brand / date if relevant

### 2. Section divider
- One phrase
- strong shift in scale or background
- only for longer decks

### 3. Stat / number slide
- one large number
- one line of context
- optional tiny source or qualifier

### 4. Image-led slide
- one image / screenshot / diagram as the anchor
- minimal caption

### 5. Comparison / two-up slide
- before vs after
- option A vs option B
- problem vs solution

### 6. Short bullet slide
- only when compression matters
- never more than 5 bullets
- each bullet must earn its place

### 7. Quote / testimonial slide
- quote
- attribution on the same slide

### 8. Closing slide
- summary, CTA, ask, or contact
- should feel like a real ending, not “thanks” filler

## Archetype recipes

Start from one of these unless the user gave a different structure.

### Pitch
Default length: 7–10 slides.

Arc:
1. Cover
2. Problem
3. Why now / context
4. Solution
5. Product / workflow
6. Traction / proof
7. Business / rollout / plan
8. Ask / closer

### Product intro
Default length: 5–8 slides.

Arc:
1. Cover
2. What it is
3. Why it matters
4. Core workflow
5. Signature feature
6. Proof / detail
7. CTA / closer

### Report-out
Default length: 6–10 slides.

Arc:
1. Cover
2. Goals
3. What shipped
4. Metrics / outcomes
5. Learnings
6. Risks / open questions
7. Next steps
8. Closer

### Keynote
Default length: 10–20 slides.

Arc:
1. Cover
2. Hook
3. Problem framing
4. Big idea
5+. Alternating evidence / scenes / examples
N. Closing statement

Use more image-led and headline slides here; less operational detail.

## Layout rules

- Keep a stable slide canvas and stable margins.
- Vary composition, not chrome. The deck should feel coherent without every
  slide looking templated.
- Footer chrome should be subtle.
- Reuse a small set of spatial zones so slides feel related.
- If the project has a design contract, obey it strictly. The contract decides
  colors, type, and tone; this skill decides deck form.

## Hard don'ts

- Do **not** make every slide a centered card on a colored background.
- Do **not** make every slide use the same hero/title/body/footer pattern.
- Do **not** turn the deck into a scrolly page.
- Do **not** put dense paragraphs on slides.
- Do **not** add decorative UI chrome that competes with the content.
- Do **not** use generic startup clichés like “our journey”, “best-in-class”,
  or “transforming the future”.
- Do **not** fabricate metrics, quotes, dates, or logos.

## Source discipline

- Every named entity, metric, quote, and attribution must come from user
  material or be clearly presented as placeholder copy.
- If critical material is missing, ask once with a compact gap list.
- If the user gave enough for a plausible placeholder demo, you may proceed
  with tasteful placeholder language rather than stalling.

## Build order

1. Read `.impeccable.md` and any linked deck assets/templates.
2. Decide the archetype recipe.
3. Sketch the slide arc in plain language.
4. Copy `deck_stage.js`.
5. Build the deck as `<deck-stage> > <section>`.
6. Check labels, flow, and word counts.

## Verification

Before declaring done:

- Keyboard nav works: arrows, space, Home, End.
- Current slide index changes correctly.
- No slide overflows at the chosen aspect ratio.
- Word budget is respected.
- Accent is restrained.
- Print path is clean.
- The deck feels like a presentation, not a webpage.

## Feedback protocol

When a user says:

- “too many slides” → name the current arc and propose cuts/merges.
- “too busy” → name the slide and what gets removed.
- “boring” → identify whether the problem is pacing, hierarchy, or story.
- “doesn’t flow” → name the broken transition between slides/sections.

Never answer with vague promises like “I’ll tighten it.”

## When not to use

- Static handout / read-aloud document → `one-pager`
- Stateful product demo → `prototype`
- Poster / single marketing composition → `one-pager`
