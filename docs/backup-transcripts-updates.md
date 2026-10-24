# Library recovery, transcript corrections, and trusted updates

The current desktop client uses the Docker server for all library data, backups, processing and accounts. For server backup/restore, follow the [self-hosting guide](self-hosting.md#backups-migration-and-recovery). Legacy local-library recovery requires desktop 0.15.4 or earlier; upgrading preserves those files but the current client never opens them.

## Restore a complete library

In **Settings → Device & storage → Library backup**, choose a complete `.tar.gz` backup.
The app streams it into a private staging directory, verifies the archive paths and SHA-256 checksums,
checks SQLite integrity and its known schema, and previews the recordings, projects, tasks, voices, and tags.
Archives produced by the existing complete-backup feature remain supported.

Restore replaces this computer's library. It does not merge two libraries.
After you confirm the preview, choose where to save a complete safety backup of the current library.
Workers, agent access, and the recorder connection close gracefully before that snapshot is taken.
The app restarts and moves the verified database into place, retaining the previous database for recovery.
Original audio in external storage folders is preserved; restored audio receives new local paths.

Restored AI credentials are disconnected, agent access is disabled, pending downloads are cleared,
and background processing/automatic device connection are paused for review. Reconnect the accounts you want,
review Settings, and explicitly resume processing. Metadata, transcript revisions, completed tasks,
deadlines, tags, voice profiles, and all embedding samples are restored.
Device-only audio is available only if it was downloaded before the backup was made.

The safety archive is a complete recovery point. Keep it until you have reviewed the restored library.
Backups contain private audio and text and are not encrypted archives.

## Correct a transcript

Hover over a transcript excerpt and choose its pencil button. Save the corrected words;
the original start/end timestamps and speaker stay attached. Search and future summaries use the corrected text.
**History** shows the saved versions and allows restoring an earlier version as a new revision.
Edits are blocked while that recording is processing or being deleted. Concurrent stale saves are rejected.

Retranscribing a corrected recording keeps the current transcript and notes active.
Choose **Compare** to inspect the new transcription and the exact proposed result.
The default retains your corrected excerpts with their original words and times. Any new excerpt
overlapping a correction is replaced in full, which is shown in the preview; word-level timing is never guessed.
You can instead use the complete new transcription or discard it and keep your current transcript.
Applying a new transcript automatically queues a summary from the accepted text.
Earlier transcript versions remain recoverable.

## Configure signed releases

The existing GitHub Actions release matrix still builds Windows x64, Linux x64 AppImage/Debian,
Intel Mac, and Apple Silicon Mac installers. Unsigned/manual builds remain available until signing is configured.
In-app installation is disabled in those builds.

Signed updates use the pinned `electron-updater@6.8.9` client. Windows keeps Authenticode
publisher verification enabled. Macs use Developer ID signing,
hardened runtime, and Apple notarization. Linux AppImage updates, all update feeds, and installer bytes
are covered by an Ed25519-signed `updates.json` manifest. Debian installations use manual/package-manager updates.
Mac update ZIPs and separate architecture feeds are published alongside the DMGs.

Configure the repository under **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `WINDOWS_CERTIFICATE` | Base64 PFX for the Windows code-signing certificate |
| Secret | `WINDOWS_CERTIFICATE_PASSWORD` | Its export password |
| Variable | `WINDOWS_PUBLISHER_NAME` | Exact certificate publisher/common name |
| Secret | `MAC_CERTIFICATE` | Base64 Developer ID Application certificate exported as P12 |
| Secret | `MAC_CERTIFICATE_PASSWORD` | Its export password |
| Secret | `APPLE_ID` | Apple Developer account used for notarization |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| Secret | `APPLE_TEAM_ID` | Developer team ID |
| Secret | `UPDATE_SIGNING_PRIVATE_KEY` | Ed25519 PKCS8 private PEM |
| Variable | `UPDATE_SIGNING_PUBLIC_KEY` | Matching Ed25519 SPKI public PEM |
| Variable | `RELEASE_SIGNING_ENABLED` | `true`, only after all configuration is ready |

Generate a dedicated manifest key pair outside the checkout:

```powershell
node scripts/release/create-update-keys.cjs "$env:USERPROFILE\HiDockNotesSigning"
```

Upload the private PEM to the encrypted secret and the public PEM to the public-key variable.
Keep a protected copy of the private key. Do not commit it or paste it into a chat.
Changing the public key requires a deliberate trust transition; keep the same key across normal releases.
Certificate workflows that require a hardware token need a supported remote signing service in place of the PFX step.

Choose an unpublished version, for example `npm run release:version -- 0.10.1`, then commit to `production`.
Every signed build fails if required credentials are absent. CI verifies the signed Windows executable and installer,
and verifies the Mac bundle's signature, Gatekeeper assessment, and notarization ticket.
Only after all four native build jobs pass does the publisher sign the manifest and publish the release.
Install the first configured signed release manually to establish its bundled update public key.

## In-app updates

The server-only desktop client uses manual installer updates for its transport shell. Application features and processing update with the Docker image. The following in-app update behavior documents legacy desktop releases through 0.15.4; it is not included in the current desktop runtime.

In **Settings → About → Application updates**, check for updates and review the release notes.
Downloads are explicit; installation and background auto-install on quit are disabled by default.
The app pins the exact stable release, verifies its manifest signature and downloaded installer hash,
and checks the installer again immediately before installation.
Choose **Back up and install**, then a destination for the complete library safety backup.
If services cannot stop or the backup fails, the app preserves the current library and does not install the update.

Implementation follows the pinned
[electron-updater client](https://github.com/electron-userland/electron-builder/tree/electron-updater%406.8.9/packages/electron-updater)
and the installed electron-builder 26 configuration types. macOS notarization requires a real Developer ID account;
certificates and notarization cannot be tested with synthetic credentials.
