# Prototype

Produce a working interactive prototype — a real app the user can click through, not a static mockup.

## Shape

Shapes: landing page / dashboard / form flow / tool / mini-app / multi-screen demo. Default: landing page with one CTA, single screen, in-memory state, mock inline data, desktop-first.

## Structure

### File layout

- **Single file default.** One self-contained `.html` with inline `<style>` and `<script>`.
- **Module split** only when scope demands it: one top-level `.html` + sibling `.js` / `.css` referenced by relative path. No bundler, no build step.
- **Starter components** from system.md § Starter Components when fit — device frames (`ios_frame.jsx` / `android_frame.jsx`) for mobile mockups, `browser_window.jsx` / `macos_window.jsx` for desktop chrome, `design_canvas.jsx` for side-by-side option explorations, `animations.jsx` for motion work.

### Screens & state (define up front)

Every prototype needs these two tables before you write code:

| Screen | Purpose | Primary CTA | Reachable from |
|---|---|---|---|

No orphan screens. Every screen reachable from at least one other screen.

| State field | Type | Default | Mutated by |
|---|---|---|---|

Keep state in **one place** — a top-level module object or a single observed store. Don't scatter `let` bindings across files.

### Non-editable chrome

Chrome that shouldn't be selectable by adits' Edit mode (nav bars, step indicators, slide counters, overlay controls) must live in **shadow DOM** (preferred, used by `<deck-stage>`) or carry `data-dm-overlay` on its root. The Edit-lane selection walker skips both. Real content stays in the light DOM so the user can click-to-edit it.

## Interaction rules

- **Interactions are real.** Buttons do something. Forms validate and submit. Toggles flip visible state. No "this would…" placeholders.
- **Every surface reachable.** Every screen has a path in. No dead ends. No unreachable states.
- **State changes are visible.** UI updates when state updates. No silent mutations.
- **Feedback for every action.** Click → active state / optimistic update / loading / success.
- **Error states real.** Triggered by a real predicate (empty required field, invalid email shape, simulated API failure). Don't pretend-fail.
- **Loading states bounded.** 300–1200ms with a real spinner or skeleton. Not instant (fake); not 5s (broken).
- **Empty and success states designed.** Empty list has a path forward. Successful submit shows confirmation, not a silent reset.
- **Keyboard reachable.** Sensible tab order. `Enter` submits primary forms. `Escape` closes modals.
- **No external API calls** unless the user asked. Inline mocks or local JSON.
- **Label screens with `data-screen-label="NN Title"`** (1-indexed) per system.md § Labelling slides and screens.

## Requirements pass

Before writing code, resolve each:

- **One-sentence purpose.** Who uses this for what.
- **Happy path.** User lands on X → clicks Y → sees Z → ends at W.
- **State model.** What mutable state exists (form values, selection, auth flag, cart, …).
- **Data shape.** What objects the app reads/writes and their minimal fields.
- **Edge paths.** Empty state, loading state, error state, success state — at minimum.

Missing anything → ask.

## Distill raw input

If input is "I want an app for X":

1. **Task → flow.** Extract each user task and write it as an ordered flow.
2. **Flow → screens.** Group steps into screens; each has a purpose + primary CTA.
3. **Screens → components.** List the components each screen needs (forms, cards, lists, modals).
4. Gap-check — missing screens, missing states (empty, loading, error, success), missing components, missing data shape.
5. Ask once with a gap table.

## Form-specific verification

Actually click through. Don't just read the code.

Beyond `done` + `fork_verifier_agent`:

- **Happy path works end-to-end** — every click and submit advances correctly.
- **Every screen reachable** via the app itself (not by URL edit).
- **Every CTA responds** — no silent buttons.
- **State visible** — change state via UI; confirm UI reflects the change.
- **Edge states present** — trigger empty, loading, error, success — each renders something designed, not a blank.
- **Keyboard** — tab reaches primary CTA; `Escape` closes modal; `Enter` submits.
- **Target match** — desktop prototypes render at 1440×900; mobile at 390×844.

## Feedback protocol

| User says | Ask |
|---|---|
| "feels slow" | Which transition — [X → Y], submit, page load? Timing is N ms. Tighten to M, or add optimistic update? |
| "confusing" | On which screen? Primary CTA is "[label]"; next step is [action]. Rename CTA [A] or add helper line [B]? |
| "dead end" | Which screen? Outgoing paths are [list]. Add link to [Y], or make [element] clickable? |
| "too plain" | Motion (currently none), visuals (accent / imagery), or layout density? Pick one. |
| "doesn't look like a real app" | Often missing chrome — header, sticky nav, loading skeleton on async? |
| "broken" | Which action? Open devtools, share the console error. Target the specific failing path. |

Never say *"I'll make it feel faster"* without naming the transition and the new timing.

## When not to use

- Static printable document → the matching document skill.
- Slide deck → `slide-deck`.
- Real backend app needing auth, persistent storage, server logic → full-stack path, not this.
- Design system itself (components, tokens, demos) → edit the design system's assets, not a prototype.
