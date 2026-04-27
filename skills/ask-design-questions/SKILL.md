---
name: ask-design-questions
description: Ask the user a short, structured set of questions when intent, audience, style, or scope is unclear. Use before committing to a design direction — the app renders the questions as a real form with chips, textareas, and file uploads.
---

# Ask design questions

Stop and ask when you are not confident about what the user wants. Guessing
burns turns; one well-structured form usually unblocks everything.

## When to use

Invoke this skill before writing any design file if you are uncertain about
any of:

- **Purpose** — what is this for, who is the audience
- **Content** — subject, copy, names, brand
- **Style** — visual direction, tone, color
- **Constraints** — format, platform, size, deadline

If you only need *one* clarification, still use this skill. Do **not** embed
questions in prose narration — the user answers prose with prose, which is
messy to parse. A form is always better.

## How to use

Write a single JSON file to `.adits/questions.json` at the project root.
The file must conform to `schema.json` (sibling of this SKILL.md).

Then **end your turn**. Do not generate any other files in the same turn —
the user can't answer questions and look at a draft at the same time.

### What the app does with it

The file is a **one-shot transport**, not durable state. The moment the app
sees it at the end of your turn:

1. It reads the JSON, validates against `schema.json`, attaches the
   payload to your turn, and **deletes the file**.
2. That turn is rendered as a form in the chat (not prose) — chips,
   textareas, dropzone. While this is the latest turn and unanswered, the
   composer greys out and a "Continue" button replaces Send.
3. When the user submits, the answers arrive as the next user turn. The
   form turn stays in chat history — scroll up and you'll see what was
   asked and what was picked.

### Consequences for you

- The file is gone after one turn. Do **not** expect it to linger — if you
  end another turn without writing a fresh one, there's no form.
- Do **not** re-write `.adits/questions.json` on follow-up turns hoping to
  re-surface the same form. Each write = one new form turn. If you need
  new clarification later, write a new file with new questions.
- Refresh / project reopen does **not** re-pop the form. The chat
  transcript is the state; nothing ambient to auto-detect.

## Authoring rules

- **Keep it short.** 3–6 questions is the target. 8 is a hard cap. If you
  have more, you are not asking questions — you are stalling.
- **One concern per question.** Never combine ("what is it for AND who is
  it for?"). Split into two.
- **Lead with the question that most constrains the design.** Purpose
  usually comes before style.
- **Write in the user's language.** If the user has been writing Chinese,
  the labels, hints, and options should be Chinese.
- **Escape hatches on taste questions.** For style/color/tone questions,
  set both `allowExplore: true` and `allowDecideForMe: true` — these
  questions have no wrong answer and the user may not have an opinion.
  Omit them on questions where you genuinely need a real answer (purpose,
  audience, content).

## Schema cheat sheet

Top-level object:

```
{
  "title": "short heading for the whole form",
  "questions": [ /* 1–8 questions */ ]
}
```

Every question has: `id` (unique slug, `[a-z0-9_]+`), `label`, optional
`hint`, and `type` — one of:

### `choice` — chip row, single-select

```json
{
  "id": "purpose",
  "label": "What is this webpage for?",
  "type": "choice",
  "options": ["Landing page", "Portfolio", "Company homepage"],
  "allowOther": true,
  "allowExplore": true,
  "allowDecideForMe": true
}
```

- `options` — 2–12 strings. Mutually exclusive; user picks one.
- `allowOther` — adds an "Other" chip with an inline text box.
- `allowExplore` — adds "Explore a few options" (you'll generate variants).
- `allowDecideForMe` — adds "Decide for me" (you pick).

### `text` — free-text area

```json
{
  "id": "topic",
  "label": "What's the subject or content?",
  "hint": "Product name, company name, key message — be specific.",
  "type": "text",
  "allowImageAttachment": true
}
```

- `allowImageAttachment` — adds a paperclip for inline image upload.

### `file` — upload dropzone

```json
{
  "id": "brand_assets",
  "label": "Have brand assets, logo, or reference images?",
  "hint": "Upload one if you have any; otherwise I'll use placeholders.",
  "type": "file"
}
```

Single file. No extra config.

## The shape of the answers

After the user submits, the next user turn arrives as JSON in this shape:

```json
{
  "answers": {
    "purpose": { "value": "Landing page" },
    "topic": { "value": "Adits is a tool for...", "images": ["files/hero.png"] },
    "brand_assets": { "file": "files/logo.svg" }
  }
}
```

Meta-selections show up as:

- `{ "value": "__other__", "text": "..." }` for `allowOther`
- `{ "value": "__explore__" }` for `allowExplore`
- `{ "value": "__decide__" }` for `allowDecideForMe`

Read those and proceed — do **not** re-ask.
