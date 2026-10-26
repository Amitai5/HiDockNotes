# Written notes

A written note is a server document with a title, optional project, tags, and rich text. It needs no recording, transcription, or AI account. The website, PWA, and hosted desktop interface use the same editor and server library.

Open a project and choose **New note**. Its header also offers **Project context** and **New note from audio**. At Library or Unfiled scope, use **Global context**. The sidebar is flat: Library, project folders, and **Unfiled items**. Use **All / Notes / Recordings** in the content rail. Recording date and status filters apply to recordings; notes remain visible in All. Drag either kind onto a project folder to move it. On a phone, **Project contents** returns from the editor to the list; the project picker switches destinations.

The editor supports paragraphs, two heading levels, bold, italic, underline, safe links, nested bullet/numbered lists, checklists, blockquotes, and undo/redo. Standard keyboard shortcuts work. Checkboxes stay in the note and do not create Actionables. Focus mode hides navigation and the content rail while leaving context controls accessible. Export Markdown or plain text from the note controls.

Edits are coalesced and saved automatically. **Saved** means the server acknowledged a revision. During network or storage failure, the editor keeps the draft and offers **Retry save**. Each save carries an expected revision and an idempotent mutation ID. Two windows cannot silently overwrite one another: the losing draft offers **Reload saved version**, **Copy draft text**, or **Save as new copy**. Leaving an unsaved note attempts a save, then asks what to do if the save fails. Closing/reloading the browser uses its native unsaved-change warning.

The server is the durable source. For recovery only, the browser keeps a private, origin- and owner-scoped draft in IndexedDB until the server accepts it. A later visit offers **Restore draft** or **Discard recovery draft**. Drafts are removed after acknowledgement, authoritative note deletion, and sign-out. If browser storage is unavailable, keep the window open until the server confirms the save. Unsaved drafts are never visible to MCP, search, Assistant, or backups. Browser storage is not a replacement for a server backup.

The latest 50 accepted revisions are retained. **Note history** opens a saved revision read only or restores its content as a new revision. Deleting a project unfiles its notes. Deleting a note removes its document, tags, history, and search entries; saved Assistant answers retain their original cited excerpts.

## Audio and project context

**New note from audio** copies audio to the server and queues the existing recording workflow. The destination is captured before reading/uploading the file and persisted with the upload. Changing projects during an import does not change its destination. Retrying an incomplete import resumes its committed offset. Importing the same file into another project creates a separate recording. If a pending destination project is deleted, choose a new destination and import again.

The recording and its project assignment commit together before the first processing job is queued. The run captures global and project context, including their versions, and reuses that snapshot across transcription, summary, restart, and retry. Explicit reprocessing captures current context. Written project notes are separate sources; they are not silently inserted into every recording summary.

## Search and AI access

Keyword search updates in the same transaction as the note. Optional local meaning search indexes saved note blocks in the background when enabled. It remains off until enabled; reading a note or using MCP does not download a model. Changed revisions invalidate old vectors. Searches recheck revision, existence, and project membership before returning semantic hits. Disabled or incomplete meaning search reports a keyword fallback.

Every saved note is available to authorized library readers. The read-only MCP catalog includes `list_notes`, `search_notes`, and `get_note`, alongside the existing recording tools and `get_reference_context`. Lists and block reads have bounded pages and continuation cursors. An omitted project includes all projects and unfiled notes; explicit null selects unfiled. Block continuations pin the returned revision. If history pruning removes it, start a fresh read. List pagination is a live scan: concurrent additions, edits, or moves may require a fresh scan. `list_projects.count` still counts recordings; `noteCount` and `itemCount` are separate.

Assistant retrieves recording passages and written-note blocks in the selected scope. Written citations carry a note ID, revision, block ID/heading, project, and exact excerpt. They show **Written note**, with **Open note** anchored to the cited block; they have no audio timestamp. Historical source panels keep the cited excerpt even if the note changes or disappears. New questions retrieve current saved content. Retrieved excerpts are sent to the selected AI provider through the existing Assistant request. Saving a note does not contact a provider or start transcription/summarization.

## Storage and upgrade

Database schema 15 adds written notes, revisions, tags, keyword and semantic indexes, upload destination metadata, and processing context snapshots. Existing recording IDs, URLs, and saved recording citations remain compatible. Documents are constrained JSON, not stored HTML. Limits are 300 title characters, 512 KiB per document, 5,000 nodes, and nesting depth 12. Pasted active content and unsafe links are removed/rejected.

Create a verified complete-library backup before upgrading. Startup also creates a database safety copy before migration. Backups include note documents, formatting, checkbox state, tags, recent revisions, projects/context, and saved written citations. Restore validates payloads before replacing the database, rebuilds keyword search, and accepts supported older archives with no note tables. Models are not required to restore. Automatic processing and device deletion remain disabled for review after restore.

Older servers refuse a newer database schema. To downgrade, restore a compatible pre-upgrade backup; do not point an old image at the migrated database. No dataset, port, or manual project-data rewrite is required. The container continues using port 10708, `/data`, `/backups`, UID/GID 568, and existing resource ceilings. Notes do not reserve an ML worker or resources while idle.

## Shorter existing recording titles (0.16.3)

On first server startup after upgrading to 0.16.3, data migration 16 applies the same six-word, 60-character title limit to existing recordings explicitly marked with AI title provenance. It keeps the beginning of each generated title, normalizes whitespace, and cuts at a word boundary. It leaves manual titles, titles of unknown provenance, original filenames, written notes, audio, transcripts, summaries, speaker choices and processing jobs unchanged. No AI request, model download, retranscription or summary regeneration is involved. The existing keyword index updates with each changed title; optional meaning-search entries are marked stale for the normal indexer.

The migration runs once in a single transaction before server workers start. Startup keeps an untouched SQLite recovery copy alongside the library database before migration, and older supported backups migrate when restored. The application creates no new tables or columns, but the migration advances the database version to 16. Use the pre-upgrade recovery copy or a compatible complete backup when downgrading to an older image.
