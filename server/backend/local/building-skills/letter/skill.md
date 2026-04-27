# Letter

Produce a formal letter as a single HTML document sized for A4 or US Letter.

## Variant & tone

Variants: cover / resignation / recommendation / outreach / memo / thank-you. Default: outreach.

Tone axis: warm / neutral / strictly formal. Default: neutral leaning formal. Warm letters use contractions; formal letters don't.

Default paper: Letter (North American audience) or A4 otherwise. Signature space reserved by default.

## Structure

Order is fixed. Keep blocks visually distinct via whitespace, not borders.

| Block | Contents | Length |
|---|---|---|
| **Letterhead / Sender** | Name, address, email/phone, optional logo. Top. | 3–5 lines |
| **Date** | Pick `April 23, 2026` or `23 April 2026`; hold | 1 line |
| **Recipient** | Name, title, organization, address | 3–5 lines |
| Subject | `Re: [short description]` — formal / memo only | 1 line |
| **Salutation** | `Dear [name],` — surname for formal, first name for warm | 1 line |
| **Body** | 2–4 paragraphs. Paragraph 1 = purpose. Final paragraph = ask. | Fills page |
| **Sign-off** | `Sincerely,` / `Best regards,` / `Warmly,` — match tone | 1 line |
| **Signature block** | ~3 blank lines (wet signature if requested) → printed name → title | 4–6 lines |
| Enclosures | `Enclosures: Resume, Portfolio` — only if attaching | 1 line |

## Writing rules

- **Open with purpose.** Paragraph 1, sentence 1, states why you are writing. No warm-up prose.
- **Close with the ask.** The final paragraph names a specific action (reply by date, meeting, reference check, acceptance).
- **One idea per paragraph.** Split if two.
- **Specific, not ornate.** "…the Staff Engineer role posted April 14" beats "…the aforementioned position."
- **No archaic phrasing.** Drop "kindly find enclosed," "I trust this letter finds you well," "as per our previous correspondence."
- **Active voice.** "I managed the migration" beats "the migration was managed by me."
- **Consistent names and dates** throughout.

## Source & material

Letters break on one wrong name, title, or date.

- **No inferred recipients.** Don't guess titles, salutations, or addresses.
- **No fabricated references** — case IDs, dates, reference numbers, prior correspondence.
- **Required items present**: sender full name, ≥1 sender contact, recipient name, date, specific purpose, recipient title/org (formal variants). If missing, produce a gap table and ask once.

## Distill raw input

Skip if the input is already a drafted letter or a clear brief (purpose + ask + supporting points).

If raw (bullet list, transcript, chat log):

1. Extract purpose, supporting points, requested action, and facts (names, dates, refs).
2. Classify into Opening / Body / Close.
3. Gap-check — explicit purpose? explicit ask? If either missing, ask.
4. Ask once with a compact gap table.

## Form-specific verification

Beyond `done` + `fork_verifier_agent`:

- **One page** at chosen paper size. Print preview confirms.
- **Facts** — every name, date, title, address matches source material.
- **Paragraph 1 states purpose. Final paragraph states the ask.**
- **Salutation matches recipient block** — same name, correct title.
- **Signature space preserved** if wet signature requested — ≥ 3 lines tall, prints that way.
- **Date format consistent** — header and any body references use the same form.

## Feedback protocol

| User says | Ask |
|---|---|
| "too formal" | Tone axis is currently [X]. Shift to [Y] — swap salutation, add contractions, loosen sign-off? |
| "too casual" | Same axes, reversed. |
| "doesn't land" | Opening sentence says "[quote]." Tighten to [option A] or sharpen the ask [option B]? |
| "signature looks wrong" | Signature block is [N lines, aligned X]. Shift to [new form]? |
| "feels cramped" | Paragraph spacing is X. Loosen to Y, or cut one paragraph? |

Never say *"I'll adjust the tone"* without naming the exact change and its new form.

## When not to use

- Multi-page proposal letters, legal briefs → long-document skill.
- Email → different medium; extract the body for an email client.
- Marketing / promotional copy in letter form → `one-pager`.
