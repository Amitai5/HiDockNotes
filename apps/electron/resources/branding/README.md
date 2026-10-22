# HiDockNotes app icon

The icon combines a folded note and five waveform bars in the existing lavender palette. The master is the first design approved for HiDockNotes, preserved without edits. It was created with the built-in image-generation tool; every platform and interface size is exported from this single master.

## Assets

- `hidocknotes-icon.png`: original high-resolution master with alpha transparency.
- `../icon.png`: 1024 px application, native About panel, and Linux icon.
- `../icon.ico`: Windows application, installer, and uninstaller icon, with seven 16–256 px images.
- `../icon.icns`: macOS icon, with eleven standard and Retina representations up to 1024 px.
- `../../public/app-icon.png`: 64 px favicon.
- `../../src/assets/brand-mark.png`: 256 px shared artwork for the title bar, Assistant welcome screen, About, and README.

## Regenerate platform files

From the repository root, after installing the existing development dependencies:

```powershell
node scripts/generate-app-icon.cjs --force
```

This uses Electron's built-in image codec and does not require another image-processing dependency. It runs a windowless helper with a separate temporary profile. The original `node scripts/generate-icons.mjs` command delegates to the same generator. The interface imports one compact asset through Vite so it works in development and packaged file-based launches.

## Generation prompt

```text
Use case: logo-brand.
Asset type: a finished, premium desktop application icon for HiDockNotes, a private app that turns recorded conversations into searchable meeting notes.
Create ONE square app icon, straight-on, centered, isolated on a genuinely transparent canvas outside the icon tile. An opaque rounded-square/squircle tile in deep midnight indigo supports one bold sculptural symbol: an ivory-lavender folded note sheet whose center contains five substantial rounded audio-wave bars. Integrate the waveform cleanly into the note-sheet design so it reads as a single memorable audio-to-notes mark. The note has one elegant folded upper corner, without written lines or tiny details.
Style: refined contemporary desktop icon, dimensional but restrained, softly beveled ceramic/frosted enamel materials, beautifully controlled studio lighting, crisp silhouette, subtle violet edge lighting, excellent contrast. The app's established accent is lavender #a497f3; use lavender, luminous soft white and midnight indigo, with a small restrained periwinkle gradient. Visually confident and distinctive at 16, 32 and 64 pixels.
Composition: the tile occupies about 90% of the square canvas, generous balanced internal spacing, central glyph large and simple. Keep all edges and any subtle shadow within the canvas. Clean front view with no perspective tilt.
Constraints: no text, no letters, no wordmark, no watermarks, no presentation board, no surrounding UI or desktop, no microphone, no headphones, no extra badges or sparkles, no decorative particles, no hairline strokes. Deliver the app icon itself as high-resolution square artwork with real alpha transparency outside its rounded tile.
```
