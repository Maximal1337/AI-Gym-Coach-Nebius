---
name: claude-design-import
description: Faithfully port a Claude Design System component (claude.ai/design, this project's "Notch Design System") into this Expo/React Native app. Use whenever implementing a guidelines/*.html spec, importing a new UI pattern from the design project, or a user says the implementation "doesn't match the design."
---

# Importing a Claude Design System component into this app

Learned the hard way on the rest-timer feature: an initial implementation
built from `guidelines/rest-timer.html` alone (its prose + the inline demo
script) got button variants, sizes, and copy visibly wrong — a second pass
against the real component source fixed all of it. Don't repeat that.

## 1. The guideline HTML is a demo, not the source of truth

`guidelines/*.html` files render a *usage story* for a component — prose,
screenshots-in-code, a Tweaks panel — by importing the compiled bundle
(`window.NotchDesignSystem_<hash>`). They are **not** where the component's
actual markup, exact button variants, sizes, or default copy live.

The real source is under `components/<category>/<Name>.jsx`, with a sibling
`.d.ts` (prop contract) and `.prompt.md` (design rationale). Always:

```
DesignSync list_files  →  find components/**/<Name>.jsx + .d.ts
DesignSync get_file     →  pull the .jsx (ground truth for markup/logic)
                         →  pull the .d.ts (prop contract, defaults)
```

Cross-reference every state the guideline's prose describes (collapsed,
expanded, done, pill, …) against the actual `.jsx` — look for early
`return` branches per state; each one can have a *completely different*
layout (e.g. RestTimer's `done` state is its own compact bar, not a
recolored version of the collapsed bar).

## 2. Pull the core primitives it composes, too

Design components import shared primitives (`components/core/Button.jsx`,
`IconButton.jsx`, `Icon.jsx`, …). Fetch those as well — a component using
`<Button variant="secondary" size="md">` only makes sense once you know
`secondary` means a filled-but-bordered pill and `size="md"` means a
44px-minimum hit target with `10px 16px` padding (see `Button.jsx`'s
`VARIANTS`/`SIZES` tables). Guessing these from the rendered screenshot
alone is how a icon-only circular pause button ends up shipping instead of
the spec's labeled pill button.

## 3. Map CSS custom properties to this app's tokens explicitly

The design system's tokens (`tokens/*.css`) are more granular than this
app's actual `packages/shared/src/tokens.ts` (e.g. it has a "raised"
surface step `--ground-300` and `IBM Plex Mono`; the app has neither).
Pull `tokens/colors.css`, `semantic.css`, `space.css`, `typography.css`
and build an explicit mapping before writing RN styles, e.g.:

```
--surface-card      -> theme.surface
--border-hairline    -> theme.rule
--volt-200 (accent)  -> theme.accent
--on-volt             -> theme.onAccent
--ink-300 (secondary) -> theme.inkSoft
--action-secondary-bg (ground-300, "raised")
                      -> no equivalent; approximate as
                         'rgba(255,255,255,0.06)' over theme.surface
--hit-target (44px)  -> literal 44
--radius-pill        -> radius.pill (already 1:1, 24px)
```

Where there's no 1:1 token, pick a pragmatic RN approximation and **say so
in a code comment** — don't silently add new colors to the shared palette
for one component, and don't guess a value with no rationale.

## 4. Copy comes from the component, not from you

The `.jsx`'s inline default `labels`/`t` object (or its `.d.ts` doc
comments) is the authoritative English copy — use it verbatim as the base
`en.json` string before translating, rather than writing your own
paraphrase (e.g. the spec's default is `"Skip rest"`, not `"Skip"` — even
if the latter reads fine standalone, matching the spec avoids a
"buttons aren't accurate" correction round-trip).

## 5. Re-verify state-by-state once done

Before calling it done, walk every state/variant the `.jsx` defines
(`done`, `expanded`, `paused`, `pill`, RTL) and check the port covers each
one's distinct layout — not just the default/happy-path state shown in the
guideline's hero screenshot.
