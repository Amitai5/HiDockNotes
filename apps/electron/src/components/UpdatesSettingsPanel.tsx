import { useEffect, useState } from 'react'
import { ArrowUpCircle, CheckCircle2, Download, ExternalLink, LoaderCircle, RotateCw } from 'lucide-react'
import { Button } from './ui'
import { MarkdownContent } from './MarkdownContent'
import { reportError } from '../store/useAppStore'
import type { UpdateState } from '../shared/updates'

export function UpdatesSettingsPanel(): JSX.Element | null {
  const api = window.electronAPI.updates
  const [state, setState] = useState<UpdateState | null>(null)
  const [choosing, setChoosing] = useState(false)
  useEffect(() => {
    if (!api) return
    let mounted = true, changed = false
    const stop = api.onState(value => { changed = true; if (mounted) setState(value) })
    void api.state().then(value => { if (mounted && !changed) setState(value) }).catch(reportError)
    return () => { mounted = false; stop() }
  }, [api])
  if (!api || !state) return null
  const active = ['checking', 'downloading', 'installing'].includes(state.phase) || choosing
  return <section className="settings-section" id="updates" tabIndex={-1}>
    <h2><ArrowUpCircle size={18} />Application updates</h2>
    <div className="backup-card update-card"><div className="backup-description"><ArrowUpCircle size={24} /><div><strong>{state.phase === 'current' ? 'You’re up to date' : state.nextVersion ? `HiDockNotes ${state.nextVersion}` : `HiDockNotes ${state.currentVersion}`}</strong><p>{state.phase === 'current' ? `Version ${state.currentVersion}` : state.phase === 'downloading' ? 'Downloading and verifying the installer…' : state.phase === 'installing' ? 'Backing up before restart…' : state.phase === 'downloaded' ? 'Ready to back up and install.' : state.phase === 'available' ? 'A newer version is available.' : 'Check GitHub for a new version.'}</p></div></div>
      <div className="update-buttons"><Button disabled={active} onClick={() => { void api.check().catch(reportError) }}>{state.phase === 'checking' ? <LoaderCircle className="animate-spin" size={15} /> : state.phase === 'current' ? <CheckCircle2 size={15} /> : <RotateCw size={15} />}{state.phase === 'checking' ? 'Checking…' : 'Check for updates'}</Button>
        {state.phase === 'available' && state.canInstall && <Button variant="primary" disabled={active} onClick={() => { void api.download().catch(reportError) }}><Download size={15} />Download update</Button>}
        {state.phase === 'downloaded' && <Button variant="primary" busy={choosing} onClick={() => { setChoosing(true); void api.install(true).catch(reportError).finally(() => setChoosing(false)) }}>Back up and install</Button>}
        {(!state.canInstall || state.phase === 'failed') && <Button variant="ghost" onClick={() => { void api.openReleases().catch(reportError) }}><ExternalLink size={15} />Installer downloads</Button>}
      </div>
      {state.phase === 'downloading' && <div className="backup-progress" role="status"><progress aria-label="Update download progress" max={1} value={state.progress} /><small>{Math.round(state.progress * 100)}%</small></div>}
      {state.phase === 'installing' && <p role="status"><LoaderCircle className="animate-spin" size={15} />Preparing your library backup and restart…</p>}
      {state.error && <p role="alert" className="danger">{state.error}</p>}
      {state.reason && <p className="privacy-note">{state.reason}</p>}
      {state.checkedAt && <small className="muted">Last checked {new Date(state.checkedAt).toLocaleString()}</small>}
    </div>
    {state.releaseNotes && <details className="update-release-notes" open><summary>What’s new in {state.nextVersion}</summary><MarkdownContent>{state.releaseNotes}</MarkdownContent></details>}
  </section>
}
