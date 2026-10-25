import { appClient } from '../services/app-client'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AudioLines, CalendarDays, Check, ChevronRight, FolderOpen, Info, Mic2, Monitor, Moon, Plug, Search, Sun, UserRound, X } from 'lucide-react'
import { Button, EmptyState, Toggle } from '../components/ui'
import { reportError, updateSettings, useAppStore } from '../store/useAppStore'
import product from '../../product.json'
import { AISettingsPanel } from '../components/AISettingsPanel'
import { VoiceProfilesPanel } from '../components/VoiceProfilesPanel'
import { AgentConnectionsPanel } from '../components/AgentConnectionsPanel'
import { BackupSettingsPanel } from '../components/BackupSettingsPanel'
import { WebUpdatesPanel } from '../components/WebUpdatesPanel'
import { GlobalReferenceContext } from '../components/ReferenceContextEditor'
import { SETTINGS_TABS, searchSettings, type SettingsTab } from '../settings/catalog'
import { SemanticSearchSettings } from '../components/SemanticSearchSettings'
import { CalendarSettings } from '../components/CalendarSettings'
import { BrandMark } from '../components/BrandMark'

const tabIcons = { general: UserRound, ai: AudioLines, voices: Mic2, calendars: CalendarDays, device: FolderOpen, agents: Plug, about: Info }
export function SettingsPage(): JSX.Element {
  const settings = useAppStore(s => s.settings)
  const [params, setParams] = useSearchParams()
  const tab: SettingsTab = SETTINGS_TABS.some(value => value.id === params.get('tab')) ? params.get('tab') as SettingsTab : 'general'
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)
  const [version, setVersion] = useState<{ version: string; runtime: string; platform: string } | null>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const focus = params.get('focus')
  const results = searchSettings(query)
  useEffect(() => { setName(settings?.name ?? '') }, [settings?.name])
  useEffect(() => { void appClient.app.info().then(setVersion).catch(reportError) }, [])
  useEffect(() => {
    if (!focus) return
    const timer = setTimeout(() => { const section = document.getElementById(focus); section?.scrollIntoView({ block: 'start' }); section?.focus({ preventScroll: true }) }, 0)
    return () => clearTimeout(timer)
  }, [focus, tab])
  function select(value: SettingsTab, id?: string): void {
    setQuery('')
    setParams(id ? { tab: value, focus: id } : { tab: value }, { replace: true })
  }
  return <div className="page settings-page">
    <div className="page-heading"><div><h1>Settings</h1></div><div className="settings-search input-with-icon"><Search size={16} /><input aria-label="Search settings" placeholder="Search settings…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); if (event.key === 'Enter' && results[0]) select(results[0].tab, results[0].id) }} />{query && <button aria-label="Clear settings search" onClick={() => setQuery('')}><X size={14} /></button>}</div></div>
    <div className="settings-tabs" role="tablist" aria-label="Settings categories" ref={tabs}>{SETTINGS_TABS.map((value, index) => {
      const Icon = tabIcons[value.id]
      return <button key={value.id} id={`settings-tab-${value.id}`} role="tab" aria-selected={tab === value.id} aria-controls={`settings-panel-${value.id}`} tabIndex={tab === value.id ? 0 : -1} onClick={() => select(value.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % SETTINGS_TABS.length : event.key === 'ArrowLeft' ? (index + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? SETTINGS_TABS.length - 1 : null
        if (next !== null) { event.preventDefault(); select(SETTINGS_TABS[next].id); (tabs.current?.children[next] as HTMLButtonElement | undefined)?.focus() }
      }}><Icon size={15} />{value.label}</button>
    })}</div>
    {query.trim() && <div className="settings-search-results" role="region" aria-label="Settings search results"><p className="muted" role="status">{results.length} matching setting{results.length === 1 ? '' : 's'}</p>{results.length ? results.map(result => <button key={result.title} onClick={() => select(result.tab, result.id)}><Search size={17} /><div><small>{SETTINGS_TABS.find(value => value.id === result.tab)?.label}</small><strong>{result.title}</strong></div><ChevronRight size={16} /></button>) : <EmptyState icon={<Search size={26} />} title="No matching settings">Try a word such as language, storage, voice, or MCP.</EmptyState>}</div>}
    <div hidden={!!query.trim() || tab !== 'general'} role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general">
      <section className="settings-section" id="your-name" tabIndex={-1}><h2><UserRound size={18} />Your name</h2><form className="name-form" onSubmit={event => { event.preventDefault(); void updateSettings({ name }).then(success => setSaved(success)) }}><input aria-label="Your name" placeholder="Your name" value={name} onChange={event => { setName(event.target.value); setSaved(false) }} maxLength={80} /><Button type="submit" variant="primary">{saved ? <Check size={15} /> : null}{saved ? 'Saved' : 'Save name'}</Button></form></section>
      <section className="settings-section" id="appearance" tabIndex={-1}><h2>Appearance</h2><div className="appearance-options">{([{ value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon }, { value: 'system', label: 'System', Icon: Monitor }] as const).map(({ value, label, Icon }) => <button key={value} className={settings?.appearance === value ? 'selected' : ''} onClick={() => { void updateSettings({ appearance: value }) }}><Icon size={20} />{label}{settings?.appearance === value && <Check size={14} />}</button>)}</div></section>
      <GlobalReferenceContext />
    </div>
    <div hidden={!!query.trim() || tab !== 'ai'} role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai"><AISettingsPanel sections={['providers', 'transcription']} /><SemanticSearchSettings /></div>
    <div hidden={!!query.trim() || tab !== 'calendars'} role="tabpanel" id="settings-panel-calendars" aria-labelledby="settings-tab-calendars"><CalendarSettings /></div>
    <div hidden={!!query.trim() || tab !== 'voices'} role="tabpanel" id="settings-panel-voices" aria-labelledby="settings-tab-voices"><VoiceProfilesPanel /><AISettingsPanel sections={['thresholds']} /></div>
    <div hidden={!!query.trim() || tab !== 'device'} role="tabpanel" id="settings-panel-device" aria-labelledby="settings-tab-device">
      <section className="settings-section" id="device-preferences" tabIndex={-1}><h2>Device preferences</h2><div className="setting-row"><div><strong>Connect automatically</strong></div><Toggle label="Connect automatically" checked={settings?.autoConnect ?? true} onChange={value => { void updateSettings({ autoConnect: value }) }} /></div><div className="setting-row"><div><strong>Auto-download new recordings</strong></div><Toggle label="Auto-download new recordings" checked={settings?.autoDownload ?? false} onChange={value => { void updateSettings({ autoDownload: value }) }} /></div><div className="setting-row"><div><strong>Delete from device after verified copy</strong><p>After copying, remove the closed device file only after the server verifies its saved audio.</p></div><Toggle label="Delete from device after verified copy" checked={settings?.autoDeleteFromDevice ?? false} onChange={value => { void updateSettings({ autoDeleteFromDevice: value }) }} /></div></section>
      <section className="settings-section" id="storage" tabIndex={-1}><h2>New recordings folder</h2><div className="storage-setting"><FolderOpen size={20} /><span title={settings?.recordingsPath}>{settings?.recordingsPath ?? 'Loading…'}</span><span className="muted">Server storage</span></div></section>
      <BackupSettingsPanel />
    </div>
    <div hidden={!!query.trim() || tab !== 'agents'} role="tabpanel" id="settings-panel-agents" aria-labelledby="settings-tab-agents"><AgentConnectionsPanel /></div>
    <div hidden={!!query.trim() || tab !== 'about'} role="tabpanel" id="settings-panel-about" aria-labelledby="settings-tab-about">
      <WebUpdatesPanel />
      <section className="settings-section" id="about" tabIndex={-1}><div className="about-app"><BrandMark size={72} /><div><h2>About {product.name}</h2><div className="version-line"><span>Version {version?.version ?? product.version}</span><span>Website & PWA</span><span>{version?.platform === 'win32' ? 'Windows' : version?.platform === 'darwin' ? 'macOS' : version?.platform ?? ''}</span></div></div></div><details className="settings-details"><summary>Licenses &amp; credits</summary><p>MIT licensed. Jensen protocol and device services adapted from sgeraldes/hidock-next-2 at commit 31d44da. Copyright © 2025 Sebastian Geraldes. Full notices are included with the source and installer.</p></details></section>
    </div>
  </div>
}
