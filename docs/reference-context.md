# Global and project reference context

## Where to edit

- **Global:** Settings → General → Global context. Settings search also finds it using terms such as glossary, background, client, acronym or spelling.
- **Project:** Open a project folder in Library and choose **Project context**.

Both editors contain Background, People & organizations, and Terminology & spellings. Use them for approved names, roles, client background, specialist terms, acronym definitions and product spellings. Changes save only when you choose Save. Unsaved global drafts survive switching Settings tabs, and project drafts survive closing and reopening the editor while staying in that folder. Discard changes restores the last loaded or saved version. If another window saves first, a stale save is rejected; choose Reload saved context to load that version explicitly.

Global context applies to every project and to unfiled recordings. Project context adds to it, taking precedence for that project's terminology and background. Blank project fields leave the global context available. Clearing a field and saving removes that reference text; it does not change existing recordings.

## How the AI uses it

Context is saved locally and is included with summary and Assistant requests to the selected AI provider. Audio transcription remains unchanged, and context is not supplied to the audio transcription provider. No automatic voice identification or transcript rewriting is performed from these reference names.

Each summary gets a consistent snapshot of global context and the recording's own project context. The same snapshot accompanies every part of a long recording and the final synthesis. A later resummary uses the most recently saved context. Saving reference context does not automatically reprocess old recordings or make provider requests; use the recording's Resummarize action to update existing notes.

When Assistant is filtered to a project, only that project's reference context is included. When searching all recordings, it includes context only for projects with retrieved source recordings, mapping each project to those recording IDs. Reference text is not indexed as a transcript or returned as a recording citation. If no transcript supports the question, Assistant does not answer from reference context alone.

Prompt rules treat reference material as background data rather than instructions or meeting evidence. Recording evidence takes precedence. Names in reference context do not prove attendance, identify a voice, expand a partial participant name, or establish an organizer. Decisions, owners, tasks and deadlines still require recording evidence. Existing participant validation continues to use transcript segments and speaker labels.

## Storage and impact

Context uses versioned JSON values in the existing settings table under `reference-context:global` and `reference-context:project:<project-id>`. There is no database schema migration or backup format change. Complete backups and restores include both scopes automatically.

Input is validated at the main-process boundary. Limits per scope are 3,000 characters of background, 1,500 characters of people/organizations, and 1,500 characters of terminology. Summaries include at most the global context and one project; Assistant source retrieval is bounded to six recordings, and only their projects can contribute context. These limits bound request growth. No production dependency is added.

The editors load context once per editing session instead of on every keystroke. Saving does not enqueue work. Adding context increases the text sent to the selected AI provider and can increase request time and plan/token usage. The feature supplies evidence rules and useful background; model interpretation remains subject to the selected provider's behavior.
