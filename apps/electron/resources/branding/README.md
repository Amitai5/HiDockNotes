# HiDockNotes app icon

The active icon is the supplied flat white note with a lavender fold and five violet waveform bars. Its 512 × 512 PNG is preserved byte for byte, including transparency. Every platform and interface size is exported from this single master; the 1024 px desktop representation is upscaled with Electron's image codec.

## Assets

- `hidocknotes-icon.png`: supplied 512 px master with alpha transparency.
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

## Visual system

The interface follows the icon's paper-and-violet palette, soft corners and restrained depth. See [the visual system](../../../../docs/visual-design.md) for tokens and component rules. The earlier dimensional icon remains in Git history.
