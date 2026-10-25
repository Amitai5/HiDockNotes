import { getDatabase } from '../database'

/** Recreates pre-feature backups for upgrade compatibility tests. */
export function removeSchema12(): void {
  removeSchema15()
  const db = getDatabase()
  for (const name of ['server_owner', 'server_sessions', 'server_uploads', 'server_device_commands', 'server_captures', 'server_tokens']) db.exec(`DROP TABLE ${name}`)
  db.exec('ALTER TABLE summaries DROP COLUMN outcomes')
  for (const name of ['assistant_source_deleted', 'semantic_transcript_updated', 'semantic_transcript_inserted', 'semantic_transcript_deleted', 'semantic_title_updated', 'semantic_summary_updated', 'semantic_summary_inserted', 'semantic_summary_deleted', 'semantic_speaker_updated']) db.exec(`DROP TRIGGER ${name}`)
  for (const name of ['assistant_messages', 'assistant_conversations', 'semantic_chunks', 'semantic_documents', 'recording_calendar', 'calendar_events', 'calendar_sources']) db.exec(`DROP TABLE ${name}`)
}

export function removeSchema15():void {
 const db=getDatabase();if(!db.prepare("SELECT name FROM sqlite_master WHERE name='written_notes'").get())return
 for(const name of ['written_note_insert','written_note_update','written_note_delete','written_note_semantic_stale'])db.exec('DROP TRIGGER '+name)
 for(const name of ['written_note_fts','written_note_semantic_chunks','written_note_semantic_documents','written_note_mutations','written_note_tags','written_note_versions','written_notes'])db.exec('DROP TABLE '+name)
 db.exec('DROP INDEX upload_request_identity');db.exec('ALTER TABLE server_uploads DROP COLUMN project_id');db.exec('ALTER TABLE server_uploads DROP COLUMN request_id');db.exec('ALTER TABLE transcription_jobs DROP COLUMN context_snapshot')
}
