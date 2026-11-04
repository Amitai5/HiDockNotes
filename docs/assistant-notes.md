# Assistant answers as written notes

Each completed Assistant answer offers **Copy**, **Save as note**, and **Append to note**. The same controls run in the hosted desktop client, browser and PWA. Saving uses the answer already shown; it does not contact an AI provider, run transcription or download models.

**Save as note** starts with the conversation title and project. Choose another title/project or Unfiled items, then Save note. **Append to note** lets you search saved notes, filter projects and load additional pages. Select a destination and Append answer. The answer follows its existing content, separated by a divider. Its title, tags, project and previous text stay intact. Both actions confirm the saved note and offer Open note or Done; the chat stays open until you choose to leave it.

The preview and saved document preserve the displayed headings, emphasis, safe links, bullet/numbered lists, personal checklists, quotes, tables, dividers and code. Notes remain editable with the existing autosave/history/recovery flow. Images retain the descriptions shown by Assistant; active HTML, scripts, embedded media and unsafe URLs are not imported. Existing document size, depth and node limits apply to the complete destination. An answer which would exceed those limits is rejected before the note is changed.

## Citations

Inline `[N]` citations become links to their known source. Source numbers inside code remain literal. Every source also has a linked entry and its saved cited excerpt in a Sources section, including when multiple answers use their own source numbering. Recording links retain the original timestamp. Written-note links pin the cited note revision and block; they do not substitute its newest text. The saved excerpts remain readable if the original source is deleted or its historical revision is pruned.

Links use the server's configured public origin rather than a transient LAN alias. In the editor, clicking or pressing Enter on a source link opens that source in the app through the normal note navigation/save guard. Ordinary external links retain the existing link behavior. Read-only previews and exported Markdown include the full source URL, so the links also work outside the editor. Viewing a source still requires authorization to that server.

These links and excerpts are ordinary, validated note content. Backups, note history, search and MCP retain them with the note. Assistant-created text is a saved written source, not a new recording or independently verified meeting evidence.

## Concurrent edits and retry

The destination is loaded at a specific revision. A concurrent change prevents the append from overwriting it; the dialog shows the latest saved document and requires **Append to latest revision** before trying again. Existing unsaved drafts in another editor retain their conflict/recovery protection. The app never silently replaces them.

A failed acknowledgement keeps the exact create/mutation ID and document in the dialog. **Retry save** can confirm the first commit without adding the answer twice. Destination inputs are held until that request is resolved; another click while saving cannot submit a second request. Keep the dialog open and retry after a connection failure. Cancelling does not remove the original answer from chat.

## Compatibility

Database schema 18 adds a version guard for the expanded rich-text document capabilities; it rewrites no existing note or table. The stored document envelope remains `documentSchema: 1`. It now permits code blocks, dividers, rectangular table rows/cells, six heading levels, and inline code/strikethrough, using the existing Tiptap and ProseMirror dependencies. No new package is added.

Upgrade the server before opening these documents. Older server versions refuse the schema-18 database, protecting formatting they cannot edit safely. For a downgrade, restore a compatible backup created before this upgrade. Complete backups and restores include the richer documents and their revisions; supported older backups still upgrade normally.

An older cached editor cannot overwrite a note containing these new formats. Current clients declare `formatVersion: 2` on `notes:save`; omitted format versions remain compatible for ordinary legacy documents. Update the app before editing a rich document. Internal move/history operations preserve full formatting.

The existing authenticated `notes:create` and `notes:save` operations are reused; there is no new write endpoint. `app:info` gains an additive optional `origin` field on the shared client, populated with the configured public origin by the server. It supplies durable citation URLs and contains no credentials.
