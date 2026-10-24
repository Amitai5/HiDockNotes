# HiDockNotes on TrueNAS

The server stores your library and runs processing. Open the same website from your computers or install it as a PWA in Chrome or Edge. HiDock connects directly to the browser over WebUSB; the server does not need USB passthrough or a desktop helper.

## Deploy the released image

Use a TrueNAS installation with Docker-based Apps/Compose support and an x86-64 CPU. The initial configuration limits usage to 8 CPUs and 12 GB RAM, runs one processing job at a time, and limits speech inference to four threads. These are upper limits with no resource reservation. Integrated graphics are not required.

1. Create separate persistent datasets for the library and backup archives. Give the configured container UID/GID write permission. The example uses `1000:1000`; set `PUID`/`PGID` to the dataset owner if different.
2. Download `compose.yaml` from the release and copy `.env.example` to `.env`.
3. Set `APP_ORIGIN` to the **exact HTTPS origin** you already serve, for example `https://notes.example.com` without a trailing slash. Set both dataset paths and pin `HIDOCKNOTES_VERSION` to the release you want.
4. Deploy the Compose file using TrueNAS Custom Apps/Compose, or run:

   ```sh
   docker compose pull
   docker compose up -d
   docker compose logs hidocknotes
   ```

5. Open the website. Copy the **eight-character setup code** from the container startup logs, then choose an owner username and a password of at least 12 characters. Codes use uppercase letters and digits without `0/O` or `1/I`. Lowercase input is accepted. The setup code is also stored at `/data/secrets/setup-code`.

The code is printed only while no owner account exists. Once the owner is created, the setup endpoint is disabled and subsequent starts do not print it. Session tokens and encryption keys remain independent, full-length secrets.

The image is `ghcr.io/amitai5/hidocknotes:<version>`. Each release also publishes `docker-image.json`, including the exact source commit and immutable image digest. To pin the exact image, replace the Compose `image:` value with the file's `pinnedImage` value. The pipeline uses the repository's GitHub token to publish; no Docker Hub account is required. If the GHCR package is private, configure a registry credential with `read:packages` in TrueNAS, or make the package public once in GitHub Packages for anonymous pulls.

To track the newest stable release, replace the service's image and add its pull policy:

```yaml
image: ghcr.io/amitai5/hidocknotes:latest
pull_policy: always
```

Compose checks the registry when deploying with `docker compose up -d`; TrueNAS must pull/redeploy the app to apply a new image. This does not poll for updates or replace a running container automatically. An engine restart alone does not pull an image. The `latest` tag is promoted from the verified image only after its stable GitHub release is published; drafts and prereleases cannot become `latest`. Versioned tags and immutable digests remain available for pinned deployments.

Compose publishes only port 10708 by default and sets the app's internal `PORT` to match. Set `WEB_PORT` to change both together. A direct image run without `PORT` still defaults to 3000. Preserve streaming responses for `/api/v1/events` and allow the upload sizes you intend to use through your proxy. Standard browser uploads are limited to 2 GB per audio file; backup restores are limited to 20 GB through the website.

### Cloudflare Tunnel

For a tunnel connector using the NAS host network, configure the published application as:

| Public hostname | Service |
| --- | --- |
| `notes.amitai.tech` | `http://localhost:10708` |

Set `APP_ORIGIN=https://notes.amitai.tech`. Cloudflare serves HTTPS to the browser and forwards to the app's HTTP listener. For a connector in a separate container, use the NAS LAN IP and port 10708 as the service URL, for example `http://10.0.0.26:10708`. Verify it with `curl http://<NAS-IP>:10708/healthz`. A healthy tunnel can still return 502 when its connector cannot reach this service. When the connector uses bridge networking, `localhost` would refer to the connector's own container. No additional application ports need publishing. Keep your existing Cloudflare Access policy if you use one; the app's owner login remains separate.

### Local network access

Keep `APP_ORIGIN` as your public HTTPS address and add exact local addresses to `APP_ALLOWED_ORIGINS`, separated by commas. For example, with host port 10708:

```yaml
environment:
  APP_ORIGIN: "https://notes.example.com"
  APP_ALLOWED_ORIGINS: "http://truenas.local:10708"
  PORT: "10708"
ports:
  - "10708:10708"
```

The local origin must match the published host port. If you also use a numeric NAS IP, add its full origin separately. Paths, trailing slashes, wildcard hosts and wildcard ports are rejected. Recreate the container after changing these environment variables.

Setup, sign-in, the library, uploads, playback, Assistant and copy buttons work at the allowed HTTP address. HTTP and HTTPS use separate host-only, HttpOnly, SameSite=Strict session cookies; public HTTPS cookies retain Secure protection. Both addresses access the same owner and library, with separate browser sign-ins. Mutation requests still require an allowed Origin and a matching CSRF token. MCP configuration uses the address currently open in the browser.

Plain HTTP sends credentials and library data without transport encryption; use it only on your trusted local network. Direct USB and PWA installation require a secure browser context, so use the HTTPS address for those features. AI workers release transcription models after each job and unload the optional semantic-search model after 60 seconds of inactivity. The 8-CPU and 12-GiB settings are upper limits, not resource reservations.

## Use the website or install the PWA

Desktop Chrome and Edge support direct USB. Open the HTTPS website, go to **Sync**, and choose **Connect device**. Select the HiDock in the browser permission prompt. Previously authorized devices can reconnect automatically while the app is open. One tab or installed window owns the recorder at a time.

Choose **Install** in the header or the browser's app-install menu to get a standalone app window. It uses the same website, server data, and browser USB permissions. Installing the PWA does not create a background USB service: leave its window or a website tab open during sync and live capture. Closing every window, sleeping the laptop, or unplugging USB interrupts capture.

| Client | Website, uploads, notes, Assistant | Direct USB |
| --- | --- | --- |
| Windows Chrome/Edge | Yes | WebUSB; the recorder interface must use WinUSB |
| macOS Chrome/Edge | Yes | WebUSB when the interface is available |
| Linux Chrome/Edge | Yes | WebUSB; the user needs permission to access the USB device |
| Firefox, Safari, iPhone/iPad | Yes | Not supported; upload audio instead |

Sync stages device audio in browser-owned temporary storage before sending it to the server. Memory is bounded, completed server uploads are checked with SHA-256, and browser staging is removed after successful import. HTTP transfers resume from committed offsets after interruption. A USB transfer interrupted before staging completes restarts from the recorder; arbitrary-offset USB resume is not assumed. The original recorder file is retained until you explicitly delete it.

The **Import audio** button accepts existing WAV, MP3, M4A/MP4, FLAC, Ogg/Opus, WebM, AAC, and HiDock HDA recordings. Uploads go to the server, not another client's local library. The website requires a server connection for private library data; the service worker caches only the app shell and static assets.

Live capture sends sequenced stereo PCM frames to the server and saves a WAV. An interrupted server-side prefix is available under Sync for explicit recovery. Treat live capture as pending physical-recorder validation until the browser/PWA gate below is completed.

## Desktop client for the server library

The desktop is a server-only client. On first launch, enter your HTTPS server origin, such as `https://notes.amitai.tech`, and choose **Connect to server**. The app reopens at your server’s owner login. It loads the hosted interface and uses the laptop’s native USB backend. Recordings, transcripts, settings, accounts, models, transcription, search, calendars and MCP all belong to the Docker server. No database, processing worker, local MCP launcher, model runtime or audio conversion tool is bundled or started on the desktop.

Use **Server → Change server** in the native menu to edit the address. A missing, invalid or unreachable server opens the connection screen; there is no local-library mode. Existing local recordings from older versions are left untouched and are never opened. Transfer an old library using a complete backup made with version 0.15.4 or earlier and restore it on the server. The client keeps only its connection preference, browser session/cache and temporary USB staging; verified uploads clear their staged audio. Only the exact configured origin can use the restricted native USB bridge. Cloudflare Access and identity-provider pages receive no native bridge. Node integration stays disabled and the hosted window remains sandboxed.

Server mode requires HTTPS for browser file staging, apart from localhost HTTP during development. Direct browser sync also needs HTTPS. The local HTTP Sync page offers **Open secure device sync** and disables unavailable USB/capture controls; server-side audio recovery remains available.

## AI and ChatGPT plan setup

Local Whisper transcription and speaker processing run on the server CPU. Models download to `/data/models` when needed. Optional semantic search is off until you choose **Download & enable** in Settings. API keys, ChatGPT tokens and private calendar links are encrypted with `/data/secrets/server.key`.

To connect your ChatGPT plan from the website:

1. Choose **Settings → AI & transcription → Continue with ChatGPT** (or **Add account**).
2. Authorize HiDockNotes in the opened tab. OpenAI returns to `http://127.0.0.1:1455/auth/callback` on the computer running your browser. Without a local listener, that tab shows a connection error; copy its **full address** from the address bar.
3. Return to HiDockNotes, paste the address into **Callback URL**, and choose **Finish connection**.
4. HiDockNotes validates the pending state, PKCE and signed identity, then saves the credentials encrypted on your server. The field clears after completion or cancellation. Callbacks expire after ten minutes and cannot be reused.

This works through the main app port over Cloudflare Tunnel or your configured local origin. No SSH tunnel or additional published port is required. The documented OpenAI plan-sign-in flow requires an HTTP `127.0.0.1` callback; replacing it with your public HTTPS address is not supported by this registration flow. See [OpenAI's registration and sign-in documentation](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

If you prefer the callback to finish automatically, you can instead open this SSH forward on the browser computer **before** signing in, then close it afterward:

```sh
ssh -N -L 1455:127.0.0.1:10708 user@your-truenas
```

The optional forward sends your computer's loopback callback to the NAS app port, which relays it to the private listener. Port 1455 is never published on the NAS. If you changed `WEB_PORT`, replace 10708 in the command with that port.

This uses HiDockNotes' existing ChatGPT authorization flow, not Codex or ChatGPT browser-profile credentials. Alternative Gemini/OpenAI API connections remain available in Settings; they are separate from a ChatGPT plan.

## Backups, migration and recovery

Use **Settings → Device & storage → Create backup**, then **Download backup**. The server also creates a backup every 24 hours while running. Archives are written to `/backups`, outside the active `/data` directory. Keep the backup dataset in your TrueNAS snapshot and replication policy; a second dataset on the same pool alone is not an independent copy.

Archives contain the consistent SQLite snapshot and all complete recording audio: transcripts and corrections/history, summaries and structured outcomes, action items and completion/dates, folders, tags, remembered people and voice embeddings, saved chats and citations, calendar metadata, settings, and server metadata. Downloadable models, caches, incomplete transfers, and the server encryption key are excluded. Reconnect AI accounts, calendars, and MCP after restore. Back up `/data/secrets` separately through your NAS recovery policy if you want to recover the server key as well.

To migrate your desktop library:

1. If you still have a local library, use desktop version **0.15.4 or earlier** to make a complete library backup before upgrading to the server-only client. Keep the original archive and old installation for recovery; newer clients do not open local library files.
2. In the website, choose **Choose backup**. The server verifies checksums, schema, file roster and counts before showing a preview.
3. Confirm the restore. The server saves a safety backup, stages remapped audio paths, and restarts through Compose. The old database is retained as a recovery point.
4. Reopen the website and sign in. A desktop backup has no web owner account, so first-run setup will appear with a code in the container logs. Restored processing is paused for review; reconnect providers, then explicitly resume processing.
5. Verify folders, voices, tags, tasks, chats, audio playback and representative transcripts before retiring the desktop copy.

Restores invalidate old web sessions and MCP tokens and clear pending recorder-delete commands. A restored backup cannot replay historical device deletes. Deleting a server recording removes its audio and associated metadata immediately; a checksum-bound cleanup command removes the original HiDock file when an authorized browser reconnects to that same recorder. Previously downloaded backups and other people's exported copies remain separate files.

Desktop backups can migrate into the server. Hosted backups use the extended server database schema and should be restored with the hosted version; keep the original desktop backup for desktop rollback.

To update, create a backup, change the pinned version, and run `docker compose pull && docker compose up -d`. The PWA checks for new static assets and offers an update; it refuses to reload while USB sync or live capture is active. To roll back across a database migration, use the previous image **and its matching pre-update backup** rather than opening a newer schema in old code.

## MCP

Enable MCP in Settings and copy its configuration. This creates a separate read-only bearer token for `/api/v1/mcp`, which uses stateless Streamable HTTP JSON-RPC. Turning MCP access off revokes all issued tokens. Tools list projects/recordings, search by keyword or optional meaning, read full notes/transcripts, list action items and meeting outcomes, and read global/project reference context. No tool deletes recordings or changes settings.

## Build and release

```sh
npm ci --strict-allow-scripts
npm run typecheck
npm run lint
npm test
npm run build:web
docker build --build-arg APP_BUILD=prebuilt -t hidocknotes:local .
```

For a source build entirely inside Docker, omit `APP_BUILD=prebuilt`. For local development, build the worker bundles first, then use `npm run dev:web` and the server with `APP_ORIGIN=http://localhost:5173`. Point `DATA_DIR` and `BACKUP_DIR` to new development directories. Never point development at the installed desktop profile or a production NAS library.

The release workflow validates the maintained web/server/protocol code once, compiles the Vite and Node assets once, then reuses those artifacts for the container. Native dependencies are installed inside the Linux image. Container startup, static PWA assets and authentication are smoke-tested before GHCR publication. Version and commit tags are published, and the release waits for both the image and all existing platform installers. A serialized final job resolves the current published stable release, verifies its Docker metadata checksum and source tag, then promotes its existing immutable image to `latest` without rebuilding. Rerunning the workflow for an already-published version also reconciles `latest` without rebuilding installers. BuildKit/npm caches accelerate subsequent builds. The exact image digest, Compose file, PWA archive and checksums accompany the release.

Source layout: `apps/web` is the browser/PWA client; `apps/server` is HTTP/auth/storage/runtime orchestration; `packages/core` holds domain, persistence, processing and integration services; `packages/jensen-protocol` is the injected WebUSB protocol. `apps/electron` builds only the server connection screen, sandboxed hosted window and native USB transport. Retained local-library sources are unbundled references and are excluded from the desktop build, runtime, dependency manifest and installer checks. The web/server builds never import Electron code.

## Physical USB release gate

Automated protocol, server and browser tests do not prove real recorder compatibility. Keep the desktop rollback until a P1 has passed: permission grant/reconnect; list and verified transfer of short and long files; cancel/drain/retry; unplug recovery; tab-vs-PWA ownership; checksum-verified device deletion; live capture and interrupted-prefix recovery; and the same operations from an installed PWA over the final HTTPS origin. Check Windows WinUSB, macOS and Linux access on the clients you intend to use. Never remove a recorder original just to satisfy a test.
