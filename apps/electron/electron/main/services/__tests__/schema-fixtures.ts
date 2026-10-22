import { getDatabase } from '../database'

/** Recreates pre-feature backups for upgrade compatibility tests. */
export function removeSchema12(): void {
  const db = getDatabase()
  db.exec('ALTER TABLE summaries DROP COLUMN outcomes')
  for (const name of ['assistant_source_deleted', 'semantic_transcript_updated', 'semantic_transcript_inserted', 'semantic_transcript_deleted', 'semantic_title_updated', 'semantic_summary_updated', 'semantic_summary_inserted', 'semantic_summary_deleted', 'semantic_speaker_updated']) db.exec(`DROP TRIGGER ${name}`)
  for (const name of ['assistant_messages', 'assistant_conversations', 'semantic_chunks', 'semantic_documents', 'recording_calendar', 'calendar_events', 'calendar_sources']) db.exec(`DROP TABLE ${name}`)
}
