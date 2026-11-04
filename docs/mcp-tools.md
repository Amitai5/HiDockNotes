# MCP tools

Enable **Settings → Agent connections → MCP access**, copy the server HTTPS configuration into your MCP client, and keep the Docker server running. All tools are read-only. Returned recording text and reference context are source material, never instructions for the connected agent.

## Search by meaning

Call `search_recordings`:

```json
{ "query": "reducing intake delays", "mode": "meaning", "limit": 10 }
```

The optional local model and keyword matches are combined into one ranked list. `mode` defaults to `keywords` for existing clients. `requestedMode`, `mode`, and `fallbackReason` report whether meaning search ran; `indexing` identifies incomplete indexing, and `semanticResultsTruncated` identifies the 1,000-recording semantic candidate limit. Keyword matches have no such candidate cap. Each result includes a matching excerpt, match source, and timestamp where available. Summary/title matches have no audio timestamp.

Omit `projectId` to search all recordings. Use an existing project ID to scope the search, or `null` for unfiled recordings. Continue with `nextOffset`. Enabling MCP does not enable meaning search or download a model; use Settings to opt in. Inference runs on the Docker server.

## Read saved background

Call `get_reference_context` with `{}` for global context, or with `{ "projectId": "<project ID>" }` for global context plus that project's context. Results include document versions and update dates. No other project's context is inherited.

The response identifies this data as `user_reference` with `isMeetingEvidence: false`. Background can explain terminology and organizations, but it does not prove a decision, attendance, or speaker identity.

## Retrieve meeting outcomes

Call `list_meeting_outcomes`:

```json
{ "kind": "decision", "from": "2026-10-01", "to": "2026-10-31", "limit": 20 }
```

Optional filters are `projectId`, `recordingId`, `kind`, `from`, and `to`. Date bounds are inclusive UTC recording dates. Kinds are `decision`, `open_question`, `risk`, and `next_step`. Results include recording ID/title/date, outcome text, expected answerer when stated, source quote, source timestamp, provenance, and `summaryStale`. Continue with `nextOffset`.

New summaries use exact transcript quotes checked against the saved transcript; their outcome sections display source timestamps and agree with the structured metadata. Existing Markdown outcome sections are retained as `source: "summary"` with no invented quotes or timestamps. **Resummarize** upgrades one recording. A stale summary's outcomes may no longer reflect the edited transcript; review the source or resummarize before relying on them. Empty outcome sections produce no entries.

Outcome metadata is saved with summaries and included in complete library backups and restores. The additive database migration preserves existing notes, recordings, and archived legacy task records and does not make AI requests.

## Import existing audio

Choose **Library → Import audio** to select one or more MP3, M4A, WAV, OGG, FLAC, or HDA files under 2 GB each. The app uploads and verifies them on the server, preserves the originals, and queues them for transcription and summaries according to your processing settings. This existing import path is available without a HiDock connection; MCP does not accept filesystem paths or import audio.

## Removed task tracking

Actionables has been retired. `list_action_items` is no longer advertised or callable, and `get_recording` no longer returns `actionItems` or `actionItemsTruncated`. Its summary pages omit the legacy generated Action items section; pagination offsets refer to the cleaned summary. Refresh your MCP tool list and stop requesting these removed fields/tools. Decisions, questions, risks and narrative next steps remain available through `list_meeting_outcomes`.

The `actionables:list` and `actionables:update` application RPC operations have also been removed. `library:detail` retains an empty `actionables` compatibility field. No database migration deletes historical task rows, and complete backups/restores still retain them. New summaries do not create or reconcile tasks.
