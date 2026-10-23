import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { Download, X } from 'lucide-react'
import type { RecordingView } from '../shared/contracts'
import { DEFAULT_EXPORT_OPTIONS, isSubtitleFormat, type RecordingExportOptions, type TranscriptFormat } from '../shared/export'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

export function RecordingExport({ recording, open: controlledOpen, onOpenChange, onClosed }: { recording: RecordingView; open?: boolean; onOpenChange?(open: boolean): void; onClosed?(): void }): JSX.Element {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [options, setOptions] = useState<RecordingExportOptions>({ ...DEFAULT_EXPORT_OPTIONS })
  async function save(): Promise<void> {
    setBusy(true)
    try {
      if (await appClient.library.exportText(recording.id, options)) { setOpen(false); setSaved(true) }
    } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <div className="recording-export"><Dialog.Root open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (value) setSaved(false) } }}>
    {controlledOpen === undefined && <Dialog.Trigger asChild><Button><Download size={16} />Export</Button></Dialog.Trigger>}
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog export-dialog" onCloseAutoFocus={event => { if (onClosed) { event.preventDefault(); onClosed() } }}>
      <div className="panel-heading"><Dialog.Title>Export recording</Dialog.Title><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label="Close export options"><X size={17} /></Button></Dialog.Close></div>
      <Dialog.Description>Choose which notes to save and whether to include a playable audio copy.</Dialog.Description>
      <form onSubmit={event => { event.preventDefault(); void save() }}>
        <fieldset disabled={busy} className="export-content"><legend>Notes to include</legend>
          <label><input type="radio" name="export-content" checked={options.content === 'summary'} onChange={() => setOptions(value => ({ ...value, content: 'summary', format: isSubtitleFormat(value.format) ? 'md' : value.format }))} /><span><strong>Summary only</strong><small>The summary, without the transcript</small></span></label>
          <label><input type="radio" name="export-content" checked={options.content === 'summary-transcript'} onChange={() => setOptions(value => ({ ...value, content: 'summary-transcript' }))} /><span><strong>Summary and transcript</strong><small>Include the timestamped, speaker-labelled transcript</small></span></label>
        </fieldset>
        <div className="export-selects"><label>File format<select aria-label="Export format" disabled={busy} value={options.format} onChange={event => setOptions(value => ({ ...value, format: event.target.value as TranscriptFormat }))}><option value="md">Markdown (.md)</option><option value="txt">Plain text (.txt)</option>{options.content === 'summary-transcript' && <><option value="srt">Transcript subtitles (.srt)</option><option value="vtt">Transcript subtitles (.vtt)</option></>}</select></label>
          <label>Include audio<select aria-label="Include audio" disabled={busy || !recording.hasAudio || !recording.verified} value={options.includeAudio ? 'yes' : 'no'} onChange={event => setOptions(value => ({ ...value, includeAudio: event.target.value === 'yes' }))}><option value="no">No — notes only</option><option value="yes">Yes — add a WAV file</option></select></label></div>
        {isSubtitleFormat(options.format) && <p className="export-note">Subtitle files contain the timestamped transcript only. Choose Markdown or plain text to include the summary.</p>}
        <p className="export-note">{options.includeAudio ? 'Choose a destination folder next. A new folder will contain your notes and a verified WAV audio copy.' : 'Choose where to save your notes next. The original recording stays in your library.'}</p>
        {!recording.verified && <p className="export-note">Audio export is available after the local recording is verified.</p>}
        <div className="dialog-actions"><Dialog.Close asChild><Button type="button" disabled={busy}>Cancel</Button></Dialog.Close><Button type="submit" variant="primary" busy={busy}><Download size={15} />{busy ? 'Exporting…' : 'Export recording'}</Button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>{saved && <small className="export-saved" role="status">Export saved</small>}</div>
}
