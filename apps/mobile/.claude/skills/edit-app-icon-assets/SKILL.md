---
name: edit-app-icon-assets
description: Programmatically edit the app's icon/splash/logo PNG layers (icon.png, splash-icon.png, logo-mark.png, android-icon-foreground.png, android-icon-background.png, android-icon-monochrome.png, favicon.png) — isolating flat-color layers, removing/rebuilding a shadow or backing layer, and reshaping a cropped sub-region — without a design tool, using Python + Pillow + numpy + OpenCV.
---

# Editing app icon/logo raster assets

All icon/logo assets live in `apps/mobile/assets/`. There's no layered
source file (no `.psd`/`.fig` in the repo) — every file is a flat PNG, so
edits have to happen by analyzing and rewriting pixels directly. Current set
(verify with `ls apps/mobile/assets/` — this list drifts, don't trust it
blindly):

| File | Referenced from | Role |
|---|---|---|
| `icon.png` | `app.json` → `icon` | Main iOS/app icon, opaque RGB |
| `splash-icon.png` | `app.json` → `splash.image` | Launch screen mark, opaque RGB |
| `logo-mark.png` | `app/sign-in.tsx` (`require(...)`) | In-app logo shown on the sign-in screen, RGBA |
| `android-icon-foreground.png` | `app.json` → `android.adaptiveIcon.foregroundImage` | Android adaptive icon foreground layer, RGBA |
| `android-icon-background.png` | `app.json` → `android.adaptiveIcon.backgroundImage` | Android adaptive icon background layer |
| `android-icon-monochrome.png` | `app.json` → `android.adaptiveIcon.monochromeImage` | Android themed-icon silhouette (Android 13+ monochrome mode) |
| `favicon.png` | `app.json` → `web.favicon` | Browser tab icon for the Expo web build |

**Current mark (as of commit `a3d1b05`, "Replace app logo with the
'Original' plate-and-bubble mark"):** a weight-plate ring (an annulus — one
flat ink/dark-colored ring shape with a hole through the middle, down to
transparent/background) plus a small green triangular speech-bubble tail
overlapping its lower-left edge. Just two flat shapes, two colors — no
separate backing/shadow layer exists in this iteration (an earlier iteration
did have one; if you're reading old context that mentions a "backing bubble"
or a "dumbbell," that's stale — always re-`Read` the actual current PNGs
before assuming what shape you're editing, don't trust a prior description
in a memory/summary/AGENTS.md). On `logo-mark.png` the ring is rendered as a
faint pale tint rather than solid ink (it's shown on a dark app background,
not a white one) — same shapes, different palette per file's background
context.

A shape edit almost always needs to be applied consistently across
`icon.png`, `splash-icon.png`, `logo-mark.png`, and
`android-icon-foreground.png` — those four encode the same mark at different
sizes/formats/alpha/color context. The Android background/monochrome and the
favicon are usually simpler derivatives (flat color, or a silhouette) —
check whether an edit needs to touch them too before assuming it doesn't.

## Setup

```bash
pip3 install --user numpy scipy opencv-python-headless pillow
```

## Workflow

1. **Load and inspect before touching anything.** Open each target PNG with
   Pillow, dump its size/mode (RGB vs RGBA — `icon.png`/`splash-icon.png` are
   typically opaque RGB; `logo-mark.png`/`android-icon-foreground.png` are
   RGBA with transparency). Get a pixel-value histogram to find the distinct
   flat color layers — this design uses a small number of solid fills (currently:
   one ink/dark tone for the ring, one green for the triangle tail), so a
   histogram of `(r,g,b)` tuples cleanly separates shapes in a way that
   eyeballing the image won't. Don't assume the current shape/color set from
   this doc — re-inspect, the mark has been redesigned before and will likely
   change again.

2. **Isolate a layer by color + connected components.** Build a boolean mask
   for the target color(s) with numpy, then use
   `cv2.connectedComponentsWithStats` to drop small stray specks (anti-
   aliasing fringe) and keep only the real shape. This gives you a clean mask
   of just the layer you want to edit (e.g. "the shadow bubble") independent
   of everything drawn on top of it.

3. **Removing a layer**: mask it out and either flood-fill with the
   neighboring background color or use `cv2.inpaint` on the masked region,
   then re-composite anything that was layered on top (read that layer's own
   mask from the *original* image first, before you inpaint, so you don't
   lose it).

4. **Rebuilding a layer uniformly** (general technique, not needed for the
   current 2-shape ring+tail mark, but relevant if a future design brings
   back a backing/echo layer — e.g. "this backing shape should be an exact
   offset copy of the front shape, not a separately-drawn mismatched one"):
   don't hand-draw it — take the mask of the shape you want to echo,
   translate it by a fixed pixel offset with `np.roll` or an affine warp, and
   fill that translated mask with the target flat color *underneath* the
   original layer (i.e. composite it first, then paste the untouched
   original layer back on top).

5. **Reshaping a sub-region** (e.g. "make the tail shorter and wider"): crop
   a bounding box around just that sub-shape, anchor the transform at a fixed
   pixel row/column (so the part that connects to the rest of the mark
   doesn't shift), and apply a `cv2.warpAffine` scale transform within that
   crop only. Paste the warped crop back into the full-size canvas at the
   same offset. Don't transform the whole image — you'll shift parts that
   need to stay fixed.

6. **Save and visually check every file the same way** — `icon.png`,
   `splash-icon.png`, `logo-mark.png`, and `android-icon-foreground.png` all
   encode the same mark at different sizes/formats, so a shape edit almost
   always needs to be applied to all of them consistently, not just one.

## Gotcha: RGBA alpha-fringe blobs

On the RGBA files (`logo-mark.png`, `android-icon-foreground.png`), building
an "occupied pixel" mask with a low alpha threshold (e.g. `alpha > 10`) will
catch the soft, near-transparent blur fringe around shapes and promote it to
full opacity when you composite — this produces large, wrong dark blobs that
aren't visible in the mask preview but show up badly in the final PNG. Use a
high threshold instead (`alpha > 200`) so only genuinely solid pixels count
as "part of the shape."

## When the user says "revert," revert — don't iterate again

If you're a few edit passes in and the user says something like "it doesn't
look good, revert to how it was" — that means stop editing and restore the
last known-good state exactly, via `git checkout <last-good-commit> --
<asset files>`. Don't attempt "one more fix" on the current state; the
instruction is to go back, not forward. Confirm the restored files are
byte-identical to that commit before reporting done.
