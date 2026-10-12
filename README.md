# HiDockNotes

A desktop recording library for HiDock devices, built with Electron, strict TypeScript, React 18 and Tailwind CSS. HiDock P1 on Windows is the primary target. macOS code paths and an electron-builder DMG configuration are included.

The public repository is [Amitai5/HiDockNotes](https://github.com/Amitai5/HiDockNotes). `production` is the default branch for the released application.

## Current build

Version 0.5.0 adds local MCP access for agent harnesses, searchable Settings tabs, and project folders within Library. It keeps audio transcription local and includes the Whisper segment-boundary fixes. **Whisper Base** is the default for faster CPU transcription. It includes **Continue with ChatGPT** for subscription-powered summaries, action items and Assistant, automatic AI processing, remembered voices, recording renaming and a matching voice waveform app icon. It is an application with a native main process, an isolated preload bridge, a SQLite database and bundled audio conversion.

- Sync: connect/disconnect, device information, read-only firmware version, P1 battery, card storage, device time, time synchronization, auto-record setting, recording list, automatic/manual downloads, progress and cancellation.
- Download safety: one serialized USB operation, firmware-safe drain/quarantine/close paths, persistent queue, atomic file writes, byte-count and SHA-256 verification, and explicit confirmed deletion after a fresh local-copy verification. Active recordings are held back.
- Library: project folders above unfiled recordings, with folders and loose recording links in the main sidebar. Folder creation lives in Library; the separate Projects page is replaced by a redirect for older links. Global FTS search includes recordings in every folder. It also provides a persistent recording list, audio import, FTS5 search over titles/transcripts/summaries, status/date/project filters, recording detail, protected audio playback, real waveform and project assignment. Markdown, TXT, SRT and VTT exports include named, timestamped transcripts; Markdown and TXT also include summaries and action items.
- Today and Actionables show generated tasks automatically, with completion, editing and links back to their recording moments. Projects group recordings and scope Assistant retrieval. Settings is organized into General, AI & transcription, Voices, Device & storage, Agent connections, and About tabs. Search matches labels and topics across all tabs and opens the relevant section; unsaved inputs survive tab changes.
- Recording detail displays the summary as formatted Markdown above the transcript, including headings, emphasis, lists, tables and code. Raw HTML is skipped and embedded images do not trigger external loads. The memoized summary does not reparse during audio playback.
- The top Export button offers summary-only or summary-and-transcript notes in Markdown/TXT, plus SRT/VTT transcript subtitles. Optional audio creates a new export folder with the notes and a verified playable 16 kHz mono WAV. Export does not overwrite the original recording; incomplete exports are cleaned up on failure.
- Actionables defaults to open tasks. Completion persists, removes a task from Open and Today, and retains it with a Done badge in Completed and in its recording. Tasks show creation and expected dates; the edit form can set or clear the due date. New summaries extract only explicit deadlines and resolve relative deadlines against the recording date. Migration 6 preserves older tasks with unknown dates, displayed as unavailable. Regenerating a summary preserves matching tasks' completion and edited deadlines.
- Recording titles can be renamed inline. This updates search and all local views while preserving the original device filename, file path and checksum. AI-generated titles never overwrite manual titles.
- Gemini and OpenAI use their official SDKs. Verify each key with a live model-list request; credentials are encrypted using Electron safeStorage and stored as SQLite BLOBs. Transcription and chat/summary provider and model selections are independent.
- Verified downloads and saved unprocessed recordings enter a persistent, single-recording background queue. An Electron utility process converts audio to 16 kHz mono WAV, runs local audio preflight, downloads checksum-pinned voice models, diarizes, transcribes bounded audio parts, aligns timestamps, identifies voices and produces a title, summary and action items. Processing resumes after restart; transient failures retry with backoff, and terminal failures have a Library Retry button.
- Whisper's native zero-duration final-segment sentinel uses the next native boundary or the real audio end. Empty/padded decoder artifacts no longer fail the entire recording, while non-finite and negative timing remains an error. See the pinned [sherpa segment conversion](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/offline-recognizer-whisper-impl.h).
- Processing skips preflight-confirmed silent sections. Private, atomically written checkpoints save each local transcription section and each speaker-analysis section. Audio preflight and completed speaker analysis are reused across retries and transcription model changes, keyed by the verified audio checksum and analysis version. Transcription checkpoints also bind to the exact decoded audio bytes, model, language and timing version. Invalid checkpoints are recomputed. This reduces repeated CPU work without increasing queue concurrency or changing device command serialization.
- On startup, verified jobs with the specific old Whisper timestamp error resume automatically only when local transcription and auto-transcription are enabled. Completed recordings and unrelated failures are retained. Existing model/language choices are preserved; set a known language in Settings to avoid repeated automatic language detection when all recordings use that language. No additional dependencies are needed for these reliability and speed changes.
- Library shows the active recording, actual stage/section progress, elapsed time and waiting count above the list. Saved audio and transcription waiting positions are displayed separately. Transcription model setup happens before expensive speaker detection. A worker startup timeout and guarded job preparation prevent a failed startup from occupying the queue indefinitely.
- Speaker detection uses two-minute sections with two seconds of context overlap, up to four CPU threads and pyannote window-shift ratio 0.5, passed in the actual native pyannote configuration. Completed sections advance progress and allow cancellation. Numeric native speaker IDs are not reused across sections: clean voice embeddings match them with cosine similarity at least 0.75 and an ambiguity margin of 0.05. The mapping keeps voices in the same section distinct, and creates a separate speaker when no confident match exists. Short public samples and boundary tests verify this behavior; long noisy meeting quality still needs real-world evaluation.
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

Your screenshots show P1 connection and verified downloads in the original build. The updated AI pipeline has been exercised with official public sample audio, real local ONNX models and mocked cloud responses, plus Windows safeStorage and SQLite persistence checks. Live cloud transcription/summary calls need a user-verified API key and have not been tested with your private recordings. macOS runtime and installer verification remain outstanding.

## Run on Windows

Install the generated `release/0.5.0/HiDockNotes Setup 0.5.0.exe`, or use the built source checkout:

```powershell
cd "$env:USERPROFILE\Documents\GitHub\HiDockNotes"
npm start
```

`Launch.cmd` starts the already-built application from this checkout without rebuilding it. Keep `node_modules` and the built `apps/electron/out` folder in place when using this launcher.

The Markdown display adds the approved, pinned `react-markdown` 10.1.0 and `remark-gfm` 4.0.1 packages. Their CommonMark/GFM parser avoids a custom Markdown implementation and renders React elements without raw HTML. They add a JavaScript parsing stack to the renderer bundle and no native runtime, model, server or network requirement. Their MIT notices are included in THIRD_PARTY_NOTICES.md.

## Develop and verify

The verified toolchain is Node.js 24 with npm 11. npm 9 encountered a dependency-resolution failure with the current test tooling. Native dependencies use their packaged N-API binaries; Electron, node-usb, ffmpeg and esbuild installation scripts are explicitly allowed in the root manifest. No Python or Docker workflow is required for the supported prebuilt platforms.

```powershell
git clone --branch production https://github.com/Amitai5/HiDockNotes.git
cd HiDockNotes
npx --yes npm@11 install
npm run build
npm run dev
```

```powershell
npm run typecheck
npm run lint
npm test
npm run package:win
```

On macOS, install on macOS so the platform's native modules and ffmpeg binary are selected, then run `npm run package:mac`. Build outputs go to `release/<version>/`. This Windows checkout's native binaries should not be reused to produce a macOS package.

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
