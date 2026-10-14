# HiDockNotes

A desktop recording library for HiDock devices, built with Electron, strict TypeScript, React 18 and Tailwind CSS. HiDock P1 on Windows is the primary target. macOS code paths and an electron-builder DMG configuration are included.

The public repository is [Amitai5/HiDockNotes](https://github.com/Amitai5/HiDockNotes). `production` is the default branch for the released application.

## Current build

Version **0.9.3** puts Actionables above Assistant and improves chat with rendered Markdown, per-answer copying, a single centered send spinner, a subtle loading indicator, and an automatically growing composer without a resize handle. Source citations open in a resizable right panel with the cited passage, nearby transcript, summary and timestamped audio, leaving the conversation and draft intact. Transcript context loads progressively instead of creating thousands of rows at once. Version 0.9.2 added saved ChatGPT account removal and provider-confirmed processing resumption from recording pages, Library and Settings. Version 0.9.1 fixed P1 connection cancellation, deletion readiness and summary-queue labels; Activity Log includes device phase events and separate current status. Version 0.9 also includes complete backups, playback isolation, and recoverable decoder-artifact cleanup.

Version 0.7.1 adds project-only folder views, a compact recording actions menu, a centered New folder dialog, and a resizable main sidebar with wrapped folder names and a distinct Unfiled inbox. It includes structured meeting summaries, evidence-based participants, meeting type, 3–7 lowercase tags, and recording-specific Resummarize / Retranscribe controls. It repairs excessive speaker fragmentation in saved recordings locally and limits new speaker groups to ten. Retranscribing automatically regenerates the summary; resummarizing uses the existing transcript. It opens directly to Library, groups sidebar navigation into Knowledge and Device & settings, and starts the folder tree collapsed. Folder branches expand independently with one navigation scrollbar. The Library root shows project folders and loose recordings. Opening a project shows only its recordings; folder destinations are kept in the sidebar. Drag recordings onto sidebar folders to move them, or onto the distinct Unfiled inbox to remove project membership. Drag the main sidebar’s right edge to resize it; arrow keys also resize, and double-click resets its width. Long folder names wrap instead of being truncated. The recording workspace puts the overview and Markdown summary on the left, with audio and transcript in a resizable right sidebar. Local MCP access and searchable Settings tabs are included. It keeps audio transcription local and includes the Whisper segment-boundary fixes. **Whisper Base** is the default for faster CPU transcription. It includes **Continue with ChatGPT** for subscription-powered summaries, action items and Assistant, automatic AI processing, remembered voices, recording renaming and a matching voice waveform app icon. It is an application with a native main process, an isolated preload bridge, a SQLite database and bundled audio conversion.

- Sync: connect/disconnect, device information, read-only firmware version, P1 battery, card storage, device time, time synchronization, auto-record setting, recording list, automatic/manual downloads, progress and cancellation.
- Download safety: one serialized USB operation, firmware-safe drain/quarantine/close paths, persistent queue, atomic file writes, byte-count and SHA-256 verification, and explicit confirmed deletion after a fresh local-copy verification. Active recordings are held back.
- Library: project folders above unfiled recordings, with folders and loose recording links in the main sidebar. Folder creation lives in Library; the separate Projects page is replaced by a redirect for older links. Global FTS search includes recordings in every folder. It also provides a persistent recording list, audio import, FTS5 search over titles/transcripts/summaries, status/date/project filters, recording detail, protected audio playback, real waveform and project assignment. Markdown, TXT, SRT and VTT exports include named, timestamped transcripts; Markdown and TXT also include summaries and action items.
- Actionables shows generated tasks automatically, with completion, editing and links back to recording moments. It sits directly under Assistant; Sync and Settings share their own section. Older Today links redirect to Library. Projects group recordings and scope Assistant retrieval. Settings is organized into General, AI & transcription, Voices, Device & storage, Agent connections, and About tabs. Search matches labels and topics across all tabs and opens the relevant section; unsaved inputs survive tab changes.
- Recording detail displays the summary as formatted Markdown above the transcript, including headings, emphasis, lists, tables and code. Raw HTML is skipped and embedded images do not trigger external loads. The memoized summary does not reparse during audio playback.
- The recording hamburger menu groups Resummarize, Retranscribe, Export and any available Transcribe / Retry action. Export offers summary-only or summary-and-transcript notes in Markdown/TXT, plus SRT/VTT transcript subtitles. Optional audio creates a new export folder with the notes and a verified playable 16 kHz mono WAV. Export does not overwrite the original recording; incomplete exports are cleaned up on failure.
- Actionables defaults to open tasks. Completion persists, removes a task from Open and Today, and retains it with a Done badge in Completed and in its recording. Tasks show creation and expected dates; the edit form can set or clear the due date. New summaries extract only explicit deadlines and resolve relative deadlines against the recording date. Migration 6 preserves older tasks with unknown dates, displayed as unavailable. Regenerating a summary preserves matching tasks' completion and edited deadlines.
- Recording titles can be renamed inline. This updates search and all local views while preserving the original device filename, file path and checksum. AI-generated titles never overwrite manual titles.
- Gemini and OpenAI use their official SDKs. Verify each key with a live model-list request; credentials are encrypted using Electron safeStorage and stored as SQLite BLOBs. Transcription and chat/summary provider and model selections are independent.
- Verified downloads and saved unprocessed recordings enter a persistent, single-recording background queue. An Electron utility process converts audio to 16 kHz mono WAV, runs local audio preflight, downloads checksum-pinned voice models, diarizes, transcribes bounded audio parts, aligns timestamps, identifies voices and produces a title, summary and action items. Processing resumes after restart; transient failures retry with backoff, and terminal failures have a Library Retry button.
- Whisper's native zero-duration final-segment sentinel uses the next native boundary or the real audio end. Empty/padded decoder artifacts no longer fail the entire recording, while non-finite and negative timing remains an error. See the pinned [sherpa segment conversion](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/offline-recognizer-whisper-impl.h).
- Processing skips preflight-confirmed silent sections. Private, atomically written checkpoints save each local transcription section and each speaker-analysis section. Audio preflight and completed speaker analysis are reused across retries and transcription model changes, keyed by the verified audio checksum and analysis version. Transcription checkpoints also bind to the exact decoded audio bytes, model, language and timing version. Invalid checkpoints are recomputed. This reduces repeated CPU work without increasing queue concurrency or changing device command serialization.
- On startup, verified jobs with the specific old Whisper timestamp error resume automatically only when local transcription and auto-transcription are enabled. Completed recordings and unrelated failures are retained. Existing model/language choices are preserved; set a known language in Settings to avoid repeated automatic language detection when all recordings use that language. No additional dependencies are needed for these reliability and speed changes.
- Library shows the active recording, actual stage/section progress, elapsed time and waiting count above the list. Saved audio and transcription waiting positions are displayed separately. Transcription model setup happens before expensive speaker detection. A worker startup timeout and guarded job preparation prevent a failed startup from occupying the queue indefinitely.
- Speaker detection uses two-minute sections with two seconds of context overlap, up to four CPU threads and pyannote window-shift ratio 0.5, passed in the actual native pyannote configuration. Completed sections advance progress and allow cancellation. Repeated local voice fragments are grouped within a recording using cosine similarity at least 0.50 and an ambiguity margin of 0.05, separately from the 0.75 threshold for assigning a remembered name. Short clean turns are pooled to obtain an embedding. Speaker groups are bounded to ten; uncertain overflow becomes an unnamed group without an enrollable embedding, or remains unassigned when all ten groups have confirmed identities. Native voices in the same section stay distinct while capacity permits. Historical unused speaker rows are excluded from participants. Short public samples and boundary tests verify this behavior; long noisy meeting quality still needs real-world evaluation.
- Speaker names can be edited throughout a transcript. Confirmed clean samples stay local, with up to ten recent samples per profile. Recognition compares all stored samples. Settings supports rename, merge, profile deletion and individual sample deletion. Corrections move the source speaker sample to the right profile. Automatic matches do not enroll unconfirmed samples.
- Assistant uses SQLite FTS5 to retrieve transcript excerpts, supports project filtering and cites recordings with links to relevant moments. There is no vector database.
- Assistant has a full-height conversation area and a rounded composer anchored at the bottom. Messages scroll independently, source links remain available, Enter sends, and Shift+Enter or IME confirmation keeps composing.
- Activity Log opens from the titlebar, uses a portal outside draggable regions, supports Close/Escape and clears the main log plus both renderer log buffers. Incoming events cannot open it.

DOCX export and Explore are not implemented. Explore is omitted because Library already provides transcript search. No firmware flashing or firmware downloads are implemented.

## Set up AI processing

1. Local Whisper is selected by default and needs no API key. The multilingual **Whisper Base** model downloads automatically on first processing (208 MB download; 161 MB retained), is checksum-verified and runs on the CPU in the background. **Whisper Small** trades speed for higher accuracy on difficult audio (640 MB download; 375 MB retained). After model setup, transcription works offline. Existing saved model choices remain intact. Existing installations switch to Local Whisper once through migration 5; your chat selection and encrypted credentials are preserved.
2. Choose transcription and chat/summary providers and models independently. For subscription-powered summaries and Assistant, choose **Continue with ChatGPT**, finish authorization in your browser and permit plan usage. This selects **ChatGPT subscription** for chat/summaries. Local transcription can finish before a summary provider is connected; the app saves the transcript and automatically queues its missing summary after setup. Gemini or OpenAI transcription is optional: select it, enter its key in the app and choose **Verify & save**. Gemini accepts AIza and AQ prefixes; a live models call checks validity. Keys are encrypted and never returned to the renderer.
3. Leave **Auto-transcribe on download** enabled. Existing verified recordings are queued automatically; **Process saved recordings** queues any unprocessed local copies.
4. Open a recording in Library to follow its stage and read the result. If processing fails, the reason and **Retry processing** are shown. Completed audio parts and the transcript are cached locally, so retrying a failed summary does not upload the whole recording again.
5. Click a speaker name in the transcript to name their voice, or confirm **Possibly <name>?**. Profiles and thresholds are managed in Settings.

With Local Whisper, audio and voice embeddings stay on this computer. Selecting cloud transcription uploads audio chunks only to the chosen Gemini or OpenAI provider. Transcript text is sent to the selected chat provider for summaries and Assistant answers. Gemini uploaded files are deleted after each request where the provider permits cleanup. Gemini’s free tier permits Google to use and human-review inputs; enable billing for business use.

### Use a ChatGPT / Codex subscription

Open Settings → AI & transcription → AI providers → **Continue with ChatGPT**. HiDockNotes uses OpenAI's official sign-in flow in your system browser with a local loopback callback, PKCE and identity validation. Choose the eligible account that holds your subscription and authorize plan usage. Identity-only permission does not enable inference. Saved connections can be selected, reconnected or signed out independently. The live account model catalog replaces the offline starting choice, `gpt-6.1-sol`; if that model is absent, the first eligible catalog entry is selected. Model availability and limits depend on your account.

This subscription route supports eligible text requests: titles, summaries, action items and Assistant answers. **It does not support audio transcription or audio/file uploads.** Local Whisper handles transcription by default; cloud transcription is optional. [OpenAI subscription inference documentation](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) explains the supported request shape; [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) cover eligibility and unsupported features.

Requests use the public OpenAI Responses endpoint with streaming and `store: false`. Only a completed response is saved. Access, refresh and identity tokens are encrypted by Electron safeStorage in the database; they are never returned to the renderer, added to browser URLs or read from another app's credentials. Refresh is serialized, rotating credentials are replaced atomically, and sign-out revokes the latest renewable token and clears the local session. Switching accounts or signing out cancels active requests tied to that connection.

**Manage usage** opens the official ChatGPT usage page. A plan limit pauses subscription requests and queued jobs; completed transcript parts stay cached. Use **Retry plan requests** after resolving the limit. HiDockNotes never switches those requests automatically to API billing. If remote sign-out cannot be confirmed, the app clears local credentials and retains a message directing you to disconnect the app in ChatGPT. [Official sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [session guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

No production dependency is added for this integration. The existing official OpenAI SDK handles inference; Node's crypto and HTTP modules handle the browser authorization callback. SQLite migration 4 adds encrypted connection storage and preserves existing recordings, API keys and settings.

### Model and voice defaults

- Local transcription: **Whisper Base multilingual**, int8 ONNX weights, using the existing `sherpa-onnx-node` runtime. **Whisper Small multilingual** remains available for higher accuracy with slower CPU processing. Both are MIT-licensed open models, downloaded from the official sherpa-onnx GitHub release. The app checks the archive and all encoder/decoder/vocabulary files against pinned SHA-256 hashes. It retains only int8 weights and vocabulary. No Python, GPU, server, token service or new runtime dependency is required. [Whisper models and language tradeoffs](https://github.com/openai/whisper#available-models-and-languages).
- Local Whisper uses native **segment timestamps**, not invented word timings. Bounded 25-second windows with overlap keep long recordings within CPU/memory limits and retain their original timebase. Voice detection and identification remain local. Model quality depends on language, microphone placement, background noise, overlapping speech and specialist vocabulary. A good short sample does not establish performance on long P1 meetings.
- Gemini transcription: **gemini-3.5-transcribe**, using the native Interactions API in verbatim mode with word_info timestamp annotations. Summary/chat: **gemini-3.5-flash**. See [Gemini transcription](https://ai.google.dev/gemini-api/docs/transcribe) and [Gemini 3.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash).
- OpenAI transcription when selected: **whisper-1**, using verbose_json word and segment timestamps. **gpt-4o-transcribe-diarize** is also offered with diarized_json segment timestamps and automatic chunking. Models without documented timestamps are excluded from the transcription selector. Summary/chat: **gpt-5.4-mini**. See [OpenAI speech to text](https://developers.openai.com/api/docs/guides/speech-to-text) and [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
- Audio parts cover 180 seconds with one second of overlap on each side (under 6 MB of mono PCM WAV per request), within the documented OpenAI 25 MB and Gemini one-hour input limits. Ownership windows remove duplicate overlap words; offsets preserve the original recording timebase. Completed parts are cached locally by input checksum, provider, model and language.
- Local models: pyannote segmentation 3.0 (MIT ONNX release) plus 3D-Speaker ERes2Net 16 kHz embedding model, from official sherpa-onnx releases. Downloads total about 47 MB and are checked against pinned SHA-256 hashes. Models are cached under app data. Only the ONNX model and license are extracted; Python is not installed or used. [Model documentation](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html).
- Voice suggestion threshold: **0.60**, from sherpa’s [speaker-identification example](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/test_speaker_identification.js). Automatic assignment: **0.75**, a conservative application starting policy, not a universally calibrated model threshold. Diarization clustering uses 0.50, a separate upstream example setting. Thresholds are configurable; speaker recognition quality depends on microphone conditions, voice similarity and sample quality.
- Added runtime dependencies: `@google/genai` and `openai` implement the requested official cloud interfaces; `sherpa-onnx-node` provides the requested local ONNX diarization and embeddings. These replace hand-written API clients and an external Python/server workflow. The native ONNX runtime increases installer size and platform maintenance requirements; models download separately. No other production dependency was added for this phase.

Your screenshots show P1 connection and verified downloads in the original build. The updated AI pipeline has been exercised with official public sample audio, real local ONNX models and mocked cloud responses, plus Windows safeStorage and SQLite persistence checks. Release CI builds Windows x64, Linux x64, Intel Mac and Apple Silicon Mac installers, runs the tests on every runner, and checks SQLite/FTS, USB module loading, the speech runtime, ffmpeg and required resources in each packaged Electron app. These checks do not open a user library or connect a recorder. Interactive macOS/Linux UI and live recorder operation on those platforms remain unverified.


### Meeting notes and regeneration

The overview shows the title, recording date/time, project, meeting type, participants and tags. Only explicitly supported attendee names are accepted; partial names are never expanded. Organizer roles require transcript evidence. Unknown voices use “Unknown speaker N.” Mentioning a person does not make them an attendee, and summary metadata never creates a voice profile.

Summaries contain 2–4 purpose/outcome paragraphs, discussion points grouped by topic, decisions, a Task / Owner / Due date table, open questions, risks / blockers, and next steps. Missing decisions read “None recorded.” Owners and dates are never guessed; missing values read “Unassigned” and “No date.” Generated tags are lowercase and cover grounded topics, any mentioned project/client, and meeting type.

Open the recording actions hamburger menu and choose **Resummarize** to generate these notes from its saved transcript without decoding audio or requiring a transcription key. **Retranscribe** creates a fresh transcription run with the current settings and automatically generates the notes afterward. Both use the persistent single-job queue. A fresh retranscription generation bypasses old transcript caches while retaining reusable audio analysis; retries and restarts resume that same generation. Existing notes remain available during regeneration. Manual titles and tags, matching completed tasks, and edited due dates are retained. Old summaries are not automatically sent to a provider; choose Resummarize for recordings you want to update.

SQLite migration 8 adds meeting metadata, tag provenance, action owners, and persistent regeneration modes. Migration 7 tags are treated as manual and preserved. Before launching 0.7.0 over an existing library, back up the database. The local speaker repair preserves segment text, timestamps, manually confirmed names and voice-sample provenance; it does not upload audio or transcribe again. Names and voice count remain uncertain when the audio is unclear; review unknown labels in the transcript.

## Install on Windows, macOS or Linux

Download the installer for your computer from [GitHub Releases](https://github.com/Amitai5/HiDockNotes/releases/latest):

| Platform | Installer |
| --- | --- |
| Windows x64 | `HiDockNotes-<version>-windows-x64-setup.exe` |
| Linux x64 | `HiDockNotes-<version>-linux-x64.AppImage` or `.deb` |
| macOS Intel | `HiDockNotes-<version>-macos-x64.dmg` |
| macOS Apple Silicon | `HiDockNotes-<version>-macos-arm64.dmg` |

The Windows installer offers an installation-folder choice and desktop shortcut. Open the Mac DMG and drag HiDockNotes into Applications. Make the Linux AppImage executable before opening it, or install the `.deb` with your package manager. Releases include `SHA256SUMS.txt` for verifying downloads. Windows builds are unsigned, and Mac builds are ad-hoc signed without Apple notarization; operating-system security prompts may appear. Public distribution with a verified publisher requires signing certificates and macOS notarization credentials.

To run the built Windows source checkout:

```powershell
cd "$env:USERPROFILE\Documents\GitHub\HiDockNotes"
npm start
```

`Launch.cmd` starts the already-built application from this checkout without rebuilding it. Keep `node_modules` and the built `apps/electron/out` folder in place when using this launcher.

The Markdown display adds the approved, pinned `react-markdown` 10.1.0 and `remark-gfm` 4.0.1 packages. Their CommonMark/GFM parser avoids a custom Markdown implementation and renders React elements without raw HTML. They add a JavaScript parsing stack to the renderer bundle and no native runtime, model, server or network requirement. Their MIT notices are included in THIRD_PARTY_NOTICES.md.

## Develop and verify

The release toolchain uses Node.js 24 with npm 11.21.0, recorded in `packageManager`. npm 9 encountered a dependency-resolution failure with the current test tooling. Native dependencies use their packaged N-API binaries; Electron, node-usb, ffmpeg and esbuild installation scripts are explicitly allowed in the root manifest. Optional fsevents installation scripts are disabled because its prebuilt binary is already included. No Python or Docker workflow is required for the supported prebuilt platforms.

```powershell
git clone --branch production https://github.com/Amitai5/HiDockNotes.git
cd HiDockNotes
npm install --global npm@11.21.0 --ignore-scripts
npm ci --strict-allow-scripts
npm run build
npm run dev
```

```powershell
npm run typecheck
npm run lint
npm test
npm run package:win
```

On macOS, install on the Mac's own architecture, then run `npm run package:mac`. On Linux x64, run `npm run package:linux` to produce AppImage and Debian packages. Build outputs go to `release/<version>/`. Install dependencies separately on each platform so ffmpeg and the native speech runtime match the target; do not reuse a Windows dependency folder for Mac or Linux packaging. `npm run smoke:native` checks the installed SQLite/FTS, USB binding, speech runtime and ffmpeg. After packaging, `npm run smoke:package` repeats those checks using the packaged Electron executable and its bundled resources, without opening the app, accessing a library, connecting a recorder, or downloading models.

## Automated version releases

[Build installers and release](https://github.com/Amitai5/HiDockNotes/actions/workflows/release.yml) runs on pushes to `production` and can also be started manually from that branch. It validates that the root manifest, Electron manifest, product metadata and both lockfile workspace entries have the same version. A version that is already published is skipped; public installers and existing tags are never replaced.

For the next release:

```powershell
npm run release:version -- 0.9.4
npm run release:check
git add package.json package-lock.json apps/electron/package.json apps/electron/product.json
git commit -m "Release 0.9.4"
git push origin production
```

Commit the intended application changes with the version update. `release:version` updates all app-version fields without changing dependencies or the independent Jensen protocol package version. Use a prerelease version such as `0.9.4-beta.1` to publish a GitHub prerelease.

Four parallel native builds run on Windows x64, Linux x64, Intel macOS and Apple Silicon macOS. Each uses the committed lockfile and runs version validation, native smoke checks, typechecking, linting, tests, packaging and a packaged-resource smoke check. The workflow pins official GitHub actions to full commit SHAs and caches npm downloads rather than sharing `node_modules` between architectures. Build jobs have read-only repository access; only the final publication job receives `contents: write` using GitHub's built-in `GITHUB_TOKEN`. No account, AI-provider or recorder credentials are needed.

After every build succeeds, publication checks that all five installers are present, creates streamed SHA-256 checksums, and creates tag `v<version>` at the exact tested commit. It uploads to a draft, verifies uploaded filenames, sizes and available server digests, then publishes the release with generated change notes. A failed build leaves the version unpublished. A failed upload leaves a draft that can be resumed by rerunning the same workflow; a tag pointing to a different commit requires a new version. Duplicate runs of the same commit and publication of the same version are serialized; different versions can finish without cancelling each other.

## USB setup

Use a USB data cable and a port that exposes the recorder's data interface. Close other recorder applications before connecting so they do not compete for the same USB interface. Connection errors are shown in Sync and the Activity Log; the app never tries firmware resets or flashes as recovery.

The pinned reference's README recommends a continuous polled USB read path to avoid locking the recorder and warns against exploratory USB scripts. This app preserves that path with node-usb **2.17.0**. A guard checks the native polling endpoint before allowing commands; unsupported backends are refused rather than falling back to unsafe reset behavior.

On Windows, `LIBUSB_ERROR_NOT_SUPPORTED` can indicate a missing WinUSB driver. The [node-usb Windows documentation](https://github.com/node-usb/node-usb#windows) describes WinUSB/Zadig and driver exclusivity. Diagnose the specific recorder data interface before replacing a driver; replacing an audio or unrelated interface can disrupt its normal function. HiDockNotes does not install drivers or change driver bindings. No P1-specific driver change was verified on this machine.

macOS uses the same node-usb backend, with no Windows driver installer involved. If the recorder is busy, close other apps holding its interface and reconnect. Actual macOS device operation is unverified.

## Files and recovery

The database is stored in Electron's user-data folder under `data/library.db`, with versioned migrations, WAL and foreign keys. Audio defaults to the `recordings` subfolder; Settings can choose a different folder for new recordings. Existing recordings retain their saved paths. Generated playback WAV files live in the user-data cache.

The copied storage path keeps the device's original bytes, including `.hda` files renamed to `.wav` for compatibility with the reference. Playback detects disguised MPEG payloads and uses bundled ffmpeg to produce a 16 kHz mono PCM WAV in the cache. The original download is retained for verification.

The persistent queue resumes after restart or interruption by downloading the incomplete file again from the beginning. Jensen's copied download command has no byte-offset resume API. A truncated transfer is failed, never silently marked complete. Recovery stages a complete replacement and checks that it is larger, longer and verified before replacing the short local copy. Device deletion always requires your confirmation and a verified copy tied to the connected device.

## Architecture and attribution

`apps/electron/product.json` is the shared source of product name, app ID and version used by the runtime, UI and packaging.

All USB and database operations run in the main process. Long audio/AI processing runs in an isolated Electron utility process; key verification and model lists run in the main process. The renderer has `nodeIntegration: false`, `contextIsolation: true` and a sandboxed, typed, allowlisted preload bridge. Audio is accessed by recording ID through a protected media protocol. The production bridge exposes no reset, format, firmware flashing or raw USB command.

The Jensen protocol package, its tests, selected device services/IPC and renderer device helpers were copied and adapted from [sgeraldes/hidock-next-2 at 31d44da](https://github.com/sgeraldes/hidock-next-2/tree/31d44da755d0980f9f30500a442459c64ce466ce), Copyright (c) 2025 Sebastian Geraldes, MIT. The reference is read-only at `../hidock-ref` and is not a runtime dependency. Copied files retain their headers and adaptation notice. The full MIT notice is in `THIRD_PARTY_NOTICES.md`; our own code is also MIT.

The new app omits the removed integrations and identity/graph systems. The device layer's old metadata enrichment and transcription orchestration were cut at their call sites and replaced by focused local storage adapters. The new voice-recognition and transcription engine uses provider and backend interfaces so further providers or an external backend can be added independently.


## Connect an agent harness with MCP

1. Keep HiDockNotes running and open **Settings → Agent connections**.
2. Enable **MCP access**. It is off on a new installation.
3. Select **Codex** or **Claude Code**, copy the generated command, and run it in your terminal (PowerShell on Windows). Restart the client so it loads the connection. Other stdio MCP clients can use the generated JSON configuration.
4. Ask your agent to find a recording, read its notes, or list outstanding action items. The tools are `list_projects`, `list_recordings`, `search_recordings`, `get_recording`, and `list_action_items`. Pages include continuation offsets for larger libraries and transcripts. `projectId: null` selects unfiled recordings.
5. Turn MCP access off to revoke reads immediately. If you move or reinstall the app at another path, copy the updated command.

The generated configuration starts the bundled `mcp-launcher.cjs` using the app executable with `ELECTRON_RUN_AS_NODE=1`. This small stdio relay starts a tools-only Electron helper and prevents Windows console startup output from interrupting MCP. On a fresh Windows profile it waits for the operating-system encryption key to be saved before the helper loads it. The helper's `--mcp-stdio` mode never starts a window, USB service, database connection, or transcription worker. It delegates paginated read requests to the normal app's authenticated loopback gateway. The discovery credential is encrypted with Electron safeStorage, never placed in command lines, URLs, logs, or plaintext configuration. The relay uses an authenticated local socket with an in-memory nonce. No additional runtime dependency, Node installation, API key, or cloud service is needed. macOS uses the same bundled executable and keychain storage.

The connection exposes notes and dated action items for reading. It does not expose audio, filesystem paths, embeddings, credentials, arbitrary SQL, writes, deletion, or device operations. Text read by a cloud-backed agent may be sent to that agent's provider; HiDockNotes does not make AI calls for MCP tool reads. Treat transcript and summary content as source material rather than instructions.

The server implements MCP's initialization, capability/version negotiation, ping, tool listing/calls, cancellation, bounded newline framing, and stdio shutdown for protocol versions 2024-11-05, 2025-03-26, 2025-06-18, and 2025-11-25. It declares only tool access. Setup follows the official [Codex MCP instructions](https://developers.openai.com/codex/mcp/) and [Claude Code MCP instructions](https://code.claude.com/docs/en/mcp), using the [MCP stdio specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Recording workspace and tags

The overview shows the editable title, recording date and time, project, participants from the diarized speaker labels, and editable tags. Rename participants using the existing local voice-profile flow. Project assignment is handled by dragging recording rows onto folders in Library; the detail page displays a link to its current folder. Drag to Unfiled to remove project membership. Folder moves change only the saved project association and leave device filenames, verified audio, and checksums intact.

Drag the divider beside the audio/transcript pane to change its width. The focused divider also supports Left/Right, Home/End, and double-click to reset. Notes and transcript scroll independently, while audio controls stay visible. The current panel width lasts while the workspace is open and adapts to the window size.

Tags are saved through the typed preload bridge to SQLite. Schema version 7 adds only the recording_tags table, retaining all existing notes and files. Up to 20 tags of 40 characters are accepted per recording, with duplicate tags normalized. The migration runs automatically; older app versions cannot open the upgraded database.


## Transcript quality and recording deletion (0.8)

A checksum-pinned 629 KB Silero speech detector runs through the existing sherpa-onnx runtime. Background sounds and unsupported sustained decoder loops are filtered before transcript storage, search and summarization. Real short acknowledgements with speech support are retained. Speech detection is cached independently of the transcription model, and old transcript/section caches use a new signature.

Diarization now clusters the entire recording in the utility process, preserving the original audio timeline while masking non-speech in memory. Five clean turns are checked for consistent embeddings; brief noise clusters and uncertain overlapping voice mixtures stay unassigned instead of becoming extra people or remembered samples. Auto clustering uses a distance threshold of 0.7, calibrated against the reported recordings. Profile assignment retains the configurable absolute thresholds and additionally requires a 0.08 margin over the runner-up. These are conservative heuristics, not guaranteed recognition accuracy.

Use **Speaker count** in the recording overview when the number of speakers is known (1–10), then **Retranscribe** from the recording menu. The known count applies once to the entire meeting. A brief real speaker can remain unidentified in Auto mode; its red label can be assigned from the speaker popup without enrolling uncertain audio. Named speaker colors affect only names. The popup provides an explicit saved-voice selector and a separate name input.

**Delete recording** in the hamburger menu requires confirmation. Device recordings require the original connected idle recorder and a fresh verified local copy. Device acknowledgement precedes local removal; offline or failed device commands retain local audio and notes. The deletion journal makes local cleanup retryable across restarts without sending an already acknowledged USB deletion again. Imported recordings delete locally. Cleanup removes audio, per-recording processing/playback caches, transcripts, summaries, actions, tags and voice samples from that recording; shared projects and other recordings' voice data are preserved. A filename-only tombstone prevents stale device scans from reimporting a deleted item. No USB reset or forced close is used.

Schema 9 adds the optional expected speaker count and a deletion journal. The migration preserves existing data. Back up the library before opening it with 0.8; older versions cannot open schema 9. Summaries hide the Markdown action-items section in the notes view, while exports and the separate Actionables list retain structured tasks.

The optional --review-library launch flag initially pauses every background audio/AI job for that session, while allowing local notes, playback, backups and device operations. **Resume processing** is available in Library, on affected recording pages, and in Settings → AI & transcription. All three use the same confirmation naming the selected providers, the data sent to each, and the automatic-processing effect. Keeping the dialog paused sends nothing; confirmation resumes the queue. Normal launches do not enable review mode. **Cancel waiting summary refreshes** preserves existing notes/audio and cancels only queued summary jobs, without creating a fresh transcription or touching active jobs. Saved provider selections and the automatic-processing preference are preserved.

Saved ChatGPT connections can be selected in Settings → AI & transcription and removed with **Remove account** after confirmation. This also works for signed-out connections. Connected sessions use the existing sign-out/revocation path before local deletion; a remote-revocation failure is reported while local removal still succeeds. The preload adds `ai.chatgpt.remove(profileId, confirmed)` / trusted `chatgpt:remove` IPC. This is additive; existing callers and persisted schema version 10 require no migration.

## Complete library backup

Choose **Create backup** in Settings (or search Settings for “backup”) and pick a destination. The app creates one standard `.tar.gz` archive using Node's built-in streaming I/O and gzip. There are no new runtime dependencies. Streaming uses bounded buffers and asynchronous compression, so large libraries do not need to fit in RAM. Low gzip compression favors speed; original recording bytes are retained without conversion or quality loss.

`data/library.db` is a complete, consistent SQLite snapshot, including pending WAL changes, created with the [better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise). It includes all tables and FTS data: recordings, transcripts, timestamped segments, speaker labels, voice profiles and embedding samples, summaries, action items with owners/deadlines/completion, projects, tags, settings, queues and recovery records. Recordings in custom storage folders are included. Duplicate references to the same audio are archived once. Encrypted agent pairing data is included when present.

`manifest.json` records app/schema versions, metadata counts, archive paths, original recording paths, and SHA-256 checksums. Audio that differed from its original verification hash is still preserved, with an explicit warning. Device-only recordings include metadata; download their audio first to include it. Missing local audio fails the operation rather than producing an incomplete backup. Files changing during streaming also fail safely. Cancel, disk and read failures leave any previous backup intact and remove this operation's staging files. The final archive is published only when the complete stream is saved.

API keys and subscription sessions are preserved only as Electron safeStorage ciphertext. They are never decrypted for export, and generally require signing in again on another OS/user account. The archive itself is not encrypted: audio, names, notes and voice embeddings are private data, so store it in a trusted location. Downloadable model weights, rebuildable caches, incomplete downloads, application binaries and browser caches are excluded. Automatic restore is not implemented. Extract with Windows Explorer or an archive utility; keep the manifest for relocating audio paths if recovering the SQLite data manually. The archive uses the portable [ustar format](https://www.gnu.org/software/tar/manual/html_node/Standard.html) and is readable on Windows/macOS.

## Saved transcript cleanup and playback (0.9)

Saved transcripts from older versions are not automatically retranscribed when a new engine is installed. On startup, local transcripts are checked for explicit non-speech decoder markers and sustained numeric/symbol loops, such as the repeated measurement string reported at the end of the Oct 5 meeting. The app creates a full SQLite safety backup before modifying anything, retains removed rows in the `transcript_artifacts` recovery table (schema 10), and updates transcript search. Normal speech, short acknowledgements, ordinary dimensions, existing speaker corrections, voice samples, summaries, tags and completed tasks are preserved. No audio or text is uploaded by cleanup. Clear numeric loops are also rejected from new output, even if noise creates a false speech-detector hit; old transcript and section caches have a new version signature.

Each recording page owns its own audio element and state. Switching recordings pauses and releases the old source, resets playback position/speed, and ignores late events or play promises from that source. Buffering shows a cancellable spinner. Source cleanup also runs when leaving the recording or deleting it. The original audio is unaffected.

## Recorder initialization and deletion (0.9.1)

Jensen's proven `tryConnect` first closes any old transport, which calls its disconnect notification even if no device was open. The app had treated that pre-connect cleanup as a physical unplug and aborted the new pipeline controller. Metadata reads finished but the cancelled pipeline never reached scanning/idle, leaving deletion blocked. The copied protocol callback now supplies an optional `cleanup`/`physical` origin; callbacks that take no arguments remain compatible. The adapter suppresses only its own pre-connect cleanup notification. Real unplug events still abort immediately, and late metadata cannot overwrite disconnected state. No wire commands, resets, force-close paths, or firmware-update behavior were added.

The confirmation dialog refreshes deletion readiness on device state changes and ignores older responses. Confirmed deletion can wait behind a passive status poll, reserving the next operation slot; foreground scans/downloads remain protected. Original-device identity, current recording checks, verified local audio, acknowledgement-before-local-removal, and graceful USB drain rules remain in force. AI job state does not determine recorder deletion readiness. SQLite schema remains 10.

### Assistant source review

Answer text renders with the existing safe Markdown renderer. Each answer has a Copy button that retains the original Markdown text, including code indentation and citation numbers. Copying runs in the main process through the additive `app.copyText(text)` / trusted `app:copy-text` bridge; no clipboard reader is exposed to the renderer. Payloads are limited to 200,000 characters. There are no new dependencies or database migrations.

Click a source card to review its cited passage and local recording in a right sidebar while continuing the chat. The panel offers transcript and summary tabs, audio playback at the cited timestamp, progressive transcript context, and a width divider controlled by drag or arrow keys. Closing or switching sources stops the previous audio; closing restores focus to its source card and retains the conversation and draft. A missing recording shows an error and retry control while preserving the cited excerpt. Reduced-motion preferences disable the loading animation. The composer grows as you type, up to a bounded height, without a manual resize grip.
