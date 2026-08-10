---
name: rn-row-height-alignment
description: Fix React Native flex-row layouts where mixed-height siblings (an icon button, a growing multiline TextInput, a text button) don't visually align — the default alignItems:'stretch' and unset heights on Pressable buttons are almost always the cause. Use when a composer/toolbar row looks vertically off, or a button collapses to an unexpectedly short height.
---

# Vertically aligning mixed-height items in a flex row

Hit repeatedly while adding a fixed-size icon button next to the chat
composer's multiline `TextInput` and `Send` button — three separate,
non-obvious RN flexbox behaviors compounded into "the row looks
uncentered." Check all three before guessing at padding tweaks.

## 1. `alignItems` defaults to `'stretch'`, not `'center'`

A row with no explicit `alignItems` **stretches every child to match the
tallest sibling** on the cross axis. Add a fixed-size 46px icon button
next to a `TextInput` that has no explicit height, and the `TextInput`
gets force-stretched to 46px too — inside which its placeholder still
top-aligns by default (multiline `TextInput`s don't auto-center), reading
as "the placeholder isn't centered."

**Fix**: explicit `alignItems: 'center'` on the row lets each child keep
its own natural height, centered against the tallest one — instead of
force-stretching a text box that then can't center its own content.

## 2. Every sibling needs an EXPLICIT height once you're not stretching

Once `alignItems` is no longer `'stretch'`, any `Pressable`/button with no
own height/minHeight collapses to just its content's natural size (e.g. a
`Text` with `paddingHorizontal` but no `paddingVertical` shrinks to the
text's line-height alone) — this is the flip side of fix #1, and easy to
introduce by only fixing the element you're looking at. Audit **every**
sibling in the row, not just the one that was visibly broken:

```tsx
<Pressable style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center', ... }}>
  <Text>Send</Text>
</Pressable>
```

## 3. `textAlignVertical="center"` is Android-only

It does nothing on iOS. For a `TextInput` that should look centered on
both platforms, don't rely on it alone — either give the input a
`minHeight` close to its siblings' height with balanced
`paddingVertical`, or leave it unstretched (fix #1) so there's no extra
vertical space inside it to be off-center within in the first place.

## 4. Diagnose "not centered" precisely before touching padding

"Not centered" can mean at least three different things — confirm which
one before editing:

- **The whole row sits high/low in its outer padded container** — check
  if `paddingTop`/`paddingBottom` on the *container* are asymmetric on
  purpose (e.g. this app's composer intentionally has a much larger
  `paddingBottom` to clear the floating tab bar — that's not a bug).
- **Siblings are different heights** (a big icon circle next to a thin
  input) — a real visual mismatch, fixed by #1/#2 above, not by nudging
  padding on one element.
- **Text/placeholder sits off-center within its own box** — an
  Android-specific `includeFontPadding` issue (RN adds extra ascent space
  above glyphs by default); fix with `includeFontPadding: false` +
  explicit `fontSize`/`lineHeight` in the `TextInput`'s `style` (it's a
  style property, not a top-level prop, and only apply this once #1/#2
  are ruled out — it's a narrower, Android-specific fix).

Ask which of these three the reporter actually means before changing
code — they look similar in a screenshot but need different fixes.
