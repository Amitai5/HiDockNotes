# Saved chats, local meaning search, and calendar links

## Saved Assistant conversations

Use **New chat** to start another conversation and **Chat history** to search, reopen, rename, or delete one. A chat keeps its project scope; changing the project selector starts a separate conversation. Answers retain their Markdown, citations, source timestamps, and excerpts. Older messages load in pages. Chat refreshes omit the optional history cursor; the server also accepts a null cursor from older cached clients as a request for the latest page. Required write revisions stay strict, so stale sends and renames cannot overwrite newer messages.

Completed exchanges are saved atomically. Failed or stopped requests leave their question available to retry, without automatically sending it again after a restart. Renaming/deleting a chat is blocked while its answer is running, and stale writes cannot replace newer messages. **Stop answer** cancels the current request. Removing a source recording redacts saved answers that cited it and removes their copied excerpts.

Complete backups include conversations, messages, pending-question recovery, and citations in the SQLite snapshot. Restore preserves their IDs and source links alongside restored recordings. A chat deletion removes its messages; it does not delete recordings.

## Optional search by meaning

After installation, choose **Download & enable** in Library, or **Skip**. The same controls live in **Settings â†’ AI & transcription â†’ Search by meaning**. There is no model download or inference on a fresh installation until you opt in. **Disable** stops search processing but retains downloaded files; **Remove model** also removes the model and derived index after confirmation.

The 23,685,172-byte download is the quantized English [all-MiniLM-L6-v2 model](https://huggingface.co/Xenova/all-MiniLM-L6-v2) at immutable revision `751bff37182d3f1213fa05d7196b954e230abad9`. Every configuration/tokenizer/model file is length- and SHA-256-verified before use. Runtime remote loading is disabled. CPU inference happens in a separate utility process, uses two threads, and releases the worker after an idle period.

Library combines keyword hits with local semantic matches and shows the matched passage. Assistant combines both retrieval routes, then rereads current transcript excerpts for citations. Unchanged recordings reuse their cached index. Corrections invalidate old entries immediately; an in-progress index cannot overwrite a newer correction. Background indexing yields while audio transcription uses the CPU. Keyword search remains available if the model is disabled or fails.

Model files are excluded from complete backups. The derived SQLite index is included with metadata, but optional search is disabled on restore. Enabling it again checks the local model or offers its download, then refreshes changed recordings. Text and embeddings are never uploaded for semantic search. Summaries and Assistant answers still use the selected text provider.

## Google Calendar without an OAuth app

Connect a private iCal feed in **Settings â†’ Calendars**. Find its URL in **Google Calendar â†’ Settings â†’ your calendar â†’ Integrate calendar â†’ Secret address in iCal format**. [Google's instructions](https://support.google.com/calendar/answer/37648/?hl=en) explain where to find it, how to reset it, and work/school account restrictions. Do not share the link publicly.

HiDockNotes accepts Google Calendar HTTPS iCal URLs only, stores private links using operating-system encryption, and never returns them in state responses or logs. Refreshes are read-only and run every 15 minutes while the app is open; a manual refresh is available. Failed refreshes retain the last successful cache. The parser handles repeating events, exclusions, rescheduled occurrences, all-day dates, and time zones in a size- and time-limited worker.

On a recording, **Link meeting** offers nearby events. Linking stores the calendar agenda, organizer and invitees separately from actual speaker identities. Nothing changes the recording title until **Use event title** is confirmed. Calendar metadata is not added as meeting evidence to summary or Assistant requests. Events removed from a feed retain their last details when linked, with a visible unavailable status; an absent event is not assumed to have been cancelled.

Complete backups include cached events and recording links. After restore, their details remain available but feed credentials are disconnected; paste the private link again to resume syncing. Removing a calendar clears its secret, event cache, and recording links while retaining recordings and notes.

## Storage and dependencies

Schema 12 adds conversation/message, semantic-index, and calendar/link tables. Existing data is retained, and the app keeps a SQLite recovery point before migrating. Complete backups from schemas 10 and 11 remain supported and migrate after restore. Older app versions cannot open a schema 12 library; keep a pre-upgrade backup if you need to return to one.

The approved production additions are pinned `@huggingface/transformers@4.3.1` and `ical.js@2.2.1`. Transformers.js supplies the standard tokenizer and ONNX inference pipeline instead of a custom ML implementation; it increases installer size and native-runtime maintenance, while the model download remains optional. Its Node runtime is overridden to `onnxruntime-node@1.23.2`, which supplies CPU bindings for Intel and Apple Silicon Macs as well as Windows and Linux. [Newer upstream Node packages omit Intel Mac bindings](https://github.com/huggingface/transformers.js/issues/1634). Its install-only ZIP/proxy helpers are pinned to patched `adm-zip@0.6.1` and `global-agent@4.1.3`; runtime inference uses the bundled CPU binaries and does not execute the installer. Release tests check all four target binaries, and each platform runs a small real inference before and after packaging. Cloud embeddings would require sending recording text and separate provider support/billing. The dependency-free iCalendar alternative would require maintaining recurrence and timezone parsing; ICAL.js provides those rules without its own dependencies. Both are isolated behind focused services, with native/resource checks in release CI. See [third-party notices](../THIRD_PARTY_NOTICES.md) for licenses.
