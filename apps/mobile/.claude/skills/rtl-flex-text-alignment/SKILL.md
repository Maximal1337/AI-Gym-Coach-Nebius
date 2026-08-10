---
name: rtl-flex-text-alignment
description: Catch and fix RTL (Hebrew/Arabic) layout bugs in this app's manually dir-driven flex rows — specifically flex:1 Text elements that don't hug the right edge in row-reverse containers. Use when writing or reviewing any row layout with dir-based flexDirection, or when a user reports text/buttons in the wrong place under Hebrew/Arabic.
---

# RTL correctness in row/row-reverse layouts

This app implements RTL **manually**, not via RN's `I18nManager.forceRTL`.
Every row does:

```tsx
const row = { flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' };
```

where `dir` comes from `useLanguage()`. Because RN's own logical-property
niceties (`I18nManager`, automatic text-direction inheritance) are opted
out of, **nothing about RTL is automatic** — every piece of directionality
has to be reasoned about and written explicitly, per element.

## The bug this caught (real, from the rest-timer "done" bar)

```tsx
<View style={{ ...row, alignItems: 'center', gap: 10 }}>
  <Icon name="checkmark-circle" />
  <Text style={{ flex: 1, ... }}>{t('restDone')}</Text>   {/* no textAlign! */}
  <Pressable>...</Pressable>
</View>
```

In Hebrew (`row-reverse`), the row visually became
`[Pressable] [Text] [Icon]` (children paint from the physical right edge in
array order — the *first* array child ends up *rightmost*, not leftmost).
The `Text`'s `flex: 1` box now spans the middle, adjacent to the icon on
its right — but `Text` has no direction-awareness of its own, so its
*content* still left-aligned by RN's default, meaning the actual glyphs
rendered hugging the **wrong** edge (next to the Pressable, not the icon)
despite the box itself being correctly positioned.

## The rule

**Any `Text` with `flex: 1` (or otherwise wider than its content) inside a
`row`/`row-reverse` container needs an explicit**
`textAlign: dir === 'rtl' ? 'right' : 'left'`. `row-reverse` only
repositions the *box*; it never touches the *content alignment* inside a
child. This is easy to miss because it silently "works" in LTR (RN's
default `left` happens to match) and only breaks once `dir === 'rtl'`
flips the physical layout — so it won't show up unless you actually
render/test the Hebrew or Arabic locale.

## How to mentally trace a row-reverse layout

Given children `[A, B, C]` in a `row-reverse` container: A paints
rightmost, B middle, C leftmost (the reverse of `row`'s A-left, C-right).
Before shipping a row, write out which child ends up on which physical
edge and check every `flex:1`/wide child inside it has matching
`textAlign`.

## Directional icons

Chevrons, send arrows, and anything else with inherent left/right meaning
need `style={dir === 'rtl' ? { transform: [{ scaleX: -1 }] } : undefined}`
— see the existing pattern in `src/components/SuggestedActionBar.tsx`'s
send icon and `src/components/RestTimer.tsx`'s `chevron-forward`.

## Checklist before merging a new row

- [ ] Every `Text`/`View` with `flex: 1` inside the row has an explicit,
      `dir`-aware `textAlign`.
- [ ] Every directional icon has a `dir`-aware flip.
- [ ] Actually mentally re-derive (or render) the row under `dir === 'rtl'`
      — don't just eyeball the LTR screenshot and assume `row-reverse`
      handled the rest.
