---
name: make-tweakable
description: Add Adits Tweaks controls to an HTML page, or create a new HTML page with in-page knobs for colors, spacing, layout variants, copy, density, and feature flags.
user-invocable: true
---

# Make Tweakable

Use this skill when the user asks for Tweaks, variants, sliders, options,
"make this tweakable", "let me adjust it", or when a selected skill chip asks
for in-design controls.

Tweaks are page-specific knobs authored in the HTML. The user operates them
inside the iframe with zero model roundtrip. File persistence still happens
through a later Claude turn when the user clicks the host's "Save N" action and
sends the generated chip.

## Contract

Add exactly one defaults block in an inline `<script>`:

```html
<script>
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#d97757",
    "density": 1,
    "showNotes": true
  }/*EDITMODE-END*/;
</script>
```

Rules:

- The marker contents must be valid JSON: double-quoted keys and strings.
- Values are flat primitives only: string, number, boolean.
- Use stable semantic keys: `accent`, `density`, `cardRadius`, `layoutVariant`.
- There must be exactly one `/*EDITMODE-BEGIN*/.../*EDITMODE-END*/` block in the root HTML file.
- Read defaults at startup and apply them before the page announces availability.

## Runtime protocol

Register the host listener before announcing availability:

```js
window.addEventListener('message', (e) => {
  if (e.data?.type === '__activate_edit_mode') openTweaks(true);
  if (e.data?.type === '__deactivate_edit_mode') openTweaks(false);
});
window.parent.postMessage({ type: '__edit_mode_available' }, '*');
```

For every control change:

1. Apply the value live in the page, usually via CSS variables on `:root`.
2. Post only the changed keys:

```js
window.parent.postMessage({
  type: '__edit_mode_set_keys',
  edits: { accent: nextAccent }
}, '*');
```

This reports a pending value to the host. It does not write the file. The host
will expose "Save N"; that chip tells Claude to merge the pending JSON into the
defaults block.

## UI

- Title the panel `Tweaks`.
- Keep it small: bottom-right floating panel or compact inline controls.
- Hide it completely while inactive. The page should look final when Tweaks are off.
- Provide controls that map to meaningful design decisions, not every raw CSS value.
- Good controls: accent color, theme, density, card radius, section rhythm,
  layout variant, chart emphasis, copy tone, show/hide optional modules.
- Bad controls: hundreds of sliders, raw pixel offsets for unrelated elements,
  controls that do not visibly change anything.

## Editing Existing HTML

When adding Tweaks to an existing page:

1. Read the page and identify 3-6 semantic knobs that fit the current design.
2. Prefer wiring existing CSS through `:root` custom properties.
3. Preserve the visible design as the default state.
4. Add the panel markup/script without turning it into page content.
5. Verify the page still works when the panel is hidden.

## Saving Prompt

If the user sends a "Save tweaks" chip, read the target HTML file, locate the
single defaults block, merge the provided pending values over the existing JSON,
and write the updated block back. Do not rewrite unrelated page structure.
