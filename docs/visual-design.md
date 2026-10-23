# Paper and violet

HiDockNotes uses the supplied white note and violet waveform as its brand mark. The design carries that same treatment through navigation, recording rows, folders, notes, chat, settings and dialogs. Existing theme choices and application workflows remain available.

## Shared tokens

Tokens live at the top of `apps/electron/src/styles.css`.

| Role | Light | Dark |
| --- | --- | --- |
| Main canvas | `#ffffff` | `#18161f` |
| Navigation | `#f8f7fc` | `#14121b` |
| Secondary surface | `#f7f5fc` | `#211e2b` |
| Text | `#282335` | `#f1edf8` |
| Secondary text | `#756f84` | `#b0a6bf` |
| Borders | `#e8e4f0` | `#35303f` |
| Links and active icons | `#7649f5` | `#a78bfa` |
| Selection | `#eee8ff` | `#302442` |

Primary actions use `--primary: #7649f5` and white text in both themes. Keeping the button fill separate from the link accent maintains readable text in dark mode. Success and danger have paired text and background tokens; unidentified speaker names retain the danger color.

## Component rules

- Use Segoe UI Variable Text with system fallbacks. Page titles are 28 px; ordinary interface and note text is 13–14 px. Secondary metadata is generally 12 px.
- Use `--control-radius` (10 px), `--panel-radius` (14 px), and `--dialog-radius` (20 px) for shared controls and surfaces.
- Keep the main light canvas true white. Use pale violet only for navigation, secondary surfaces and selected states. Dark mode uses plum-gray surfaces rather than a blue cast.
- Recording rows remain a scannable list. Each uses the shared note artwork, a title, metadata, a status, and the existing navigation behavior. Project folders retain their own folder symbol.
- Show project navigation initially; keep individual folders collapsed until expanded. Keep Unfiled compact and distinguish it with a quiet outline. Navigation and recording sidebars remain resizable.
- Keep recording notes open and typographic. Frame audio and transcript together in one secondary panel, starting at 480 px and clamping to the window's available width. Color speaker names while leaving transcript prose neutral.
- Give dialogs a consistent radius, border, backdrop and focus treatment. Existing keyboard navigation, focus restoration, reduced-motion handling and native controls remain in place.
- Reuse the shared `BrandMark` image for chrome, recording rows, Assistant and About. The asset is cached once by the renderer; do not inline another copy per row.

The icon master and regeneration instructions are in `apps/electron/resources/branding/`. No additional runtime dependencies, fonts, application data migrations or network resources are needed for this visual system.
