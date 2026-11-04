# Project Catch me up

Open a project in Library and choose **Catch me up** next to Project context. The same view is served to desktop clients, browsers and the PWA. It is available for named projects; Library and Unfiled items retain their existing workspace.

Choose **Last 7 days**, **Last 30 days** (the default) or **Last 90 days**, then **Generate briefing**. The briefing contains an at-a-glance overview, changes across meetings, recent decisions, and open questions. **Refresh briefing** explicitly generates a replacement. Opening the view, changing a period, receiving library updates and reopening a saved result never call an AI provider.

## Evidence and coverage

The server selects at most 12 recent, verified recordings with nonempty, current summaries inside the rolling period. The view shows the available and selected counts. Recordings without a usable summary are not evidence; summaries made stale by transcript edits are explicitly excluded until resummarized. The briefing does not transcribe or resummarize recordings.

Input is bounded to opening summary excerpts plus selected structured or legacy meeting outcomes, including decisions and questions below the opening of a long summary. At most 96 sources and 60,000 source JSON characters are supplied, plus the existing bounded global/project reference context. Reference text remains background, not meeting evidence. Written project notes are not silently treated as recorded statements.

Every generated item requires source numbers from that request. A change must cite at least two distinct recordings; one meeting cannot establish a cross-meeting change. Prompts distinguish decisions from suggestions, historical unanswered questions from confirmed current state, and changes from merely different meeting topics. These checks validate source references, not semantic truth: review important claims against their sources.

Source buttons open the saved supporting passage. **Summary** means generated notes and never claims to be a transcript quote. Transcript sources are offered only when the saved evidence quote matches the current transcript; their link opens the recording at an actual segment timestamp. Summary links open the recording without fabricating a timestamp. A modal supports keyboard focus, Escape and restoration to its source button.

## Generation

Generation uses the selected **Chat & summaries** provider/model and existing authenticated credentials. The same setup, usage-pause and restore-review restrictions apply. There is one active project briefing request per server; repeated requests for the same project/period share the in-flight result. Other projects/periods wait for that request to finish. **Cancel** aborts the provider request. Requests have a 90-second abort deadline and are stopped during shutdown or restore. Failed, cancelled, malformed or unsupported output does not replace the last successful result. There is no automatic retry or scheduled generation.

Selected saved meeting text, source excerpts and the applicable reference context are sent to that text provider. Original audio and models remain on the Docker server; this feature downloads no model and adds no production dependency.

## Persistence and API

Each project/period keeps its last successful generated result under the versioned `project-briefing:<project-id>:<days>` key in the existing server settings store. Complete library backups already include this store. No database migration, archive-format change or existing API replacement is needed. Source/project-context fingerprints prevent displaying an obsolete result after its evidence changes. Concurrent source edits prevent a finishing request from saving a stale briefing. Moving a recording clears both projects' derived caches; deleting a recording clears its project's derived briefing text.

The shared client adds `projectBriefing.get(projectId, { days })`, `generate(projectId, { days })` and `cancel(projectId)`. Their additive RPC operations are `project-briefing:get`, `project-briefing:generate` and `project-briefing:cancel`. Project identifiers and periods are validated. These use the existing owner session, allowed-origin and CSRF checks; they are not exposed through the read-only MCP tool catalog. Old clients continue to use their existing operations. Old backups simply have no cached briefings; generate one after upgrading and reviewing provider settings.

The route is `/library?project=<id>&view=briefing`. Choosing a recording/note in the contents rail opens it in the existing workspace. Generating preserves library content, manual titles, transcript edits, and summaries. Archived legacy task records remain untouched; this view has no task list.
