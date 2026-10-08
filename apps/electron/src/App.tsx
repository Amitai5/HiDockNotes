import { useEffect } from 'react'
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Activity, AudioLines, BookOpen, CheckSquare, FolderClosed, MessageSquare, Minus, Moon, Search, Settings, Square, Sun, Usb, X } from 'lucide-react'
import product from '../product.json'
import { useDevicePipeline } from './hooks/useDevicePipeline'
import { useDeviceSubscriptions } from './hooks/useDeviceSubscriptions'
import { useAppStore, updateSettings } from './store/useAppStore'
import { ActivityLog } from './components/ActivityLog'
import { SyncPage, modelName } from './pages/SyncPage'
import { LibraryPage } from './pages/LibraryPage'
import { RecordingPage } from './pages/RecordingPage'
import { TodayPage } from './pages/TodayPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ActionablesPage } from './pages/ActionablesPage'
import { SettingsPage } from './pages/SettingsPage'
import { AssistantPage } from './pages/AssistantPage'

const sections = [
  { label: 'Knowledge', items: [{ label: 'Today', path: '/today', Icon: Sun }, { label: 'Library', path: '/library', Icon: BookOpen }, { label: 'Assistant', path: '/assistant', Icon: MessageSquare }] },
  { label: 'Organization', items: [{ label: 'Projects', path: '/projects', Icon: FolderClosed }] },
  { label: 'Actions', items: [{ label: 'Actionables', path: '/actionables', Icon: CheckSquare }] },
  { label: 'Device', items: [{ label: 'Sync', path: '/sync', Icon: Usb }] }
]
function Shell(): JSX.Element {
  const device = useDevicePipeline()
  useDeviceSubscriptions()
  const settings = useAppStore(s => s.settings)
  const search = useAppStore(s => s.search)
  const setSearch = useAppStore(s => s.setSearch)
  const setActivityOpen = useAppStore(s => s.setActivityOpen)
  const error = useAppStore(s => s.error)
  const setError = useAppStore(s => s.setError)
  const navigate = useNavigate()
  const location = useLocation()
  const connected = device.state.device !== null && !['disconnected', 'error'].includes(device.state.phase)
  const active = !['disconnected', 'idle', 'error'].includes(device.state.phase)
  const unsynced = device.files.filter(f => !f.localVerified).length
  useEffect(() => {
    document.title = product.name
    const match = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = settings?.appearance === 'dark' || (settings?.appearance === 'system' && match.matches) ? 'dark' : 'light' }
    apply(); match.addEventListener('change', apply)
    return () => match.removeEventListener('change', apply)
  }, [settings?.appearance])
  return <div className="app-shell">
    <header className="titlebar"><div className="brand"><AudioLines size={24} strokeWidth={2.2} /><span>{product.name}</span></div><form className="global-search input-with-icon" onSubmit={e => { e.preventDefault(); navigate('/library') }}><Search size={17} /><input aria-label="Search your recordings" placeholder="Search your recordings" value={search} onChange={e => { setSearch(e.target.value); if (e.target.value) navigate('/library') }} /><kbd>Enter</kbd></form><div className={`device-chip ${connected ? 'connected' : ''}`}><span />{modelName(device.state.device?.model)} <b>·</b> {connected ? 'Connected' : 'Disconnected'}</div><button className="activity-trigger" onClick={() => setActivityOpen(true)}><Activity size={17} className={active ? 'pulse-accent' : ''} /><span>Activity</span></button><div className="window-controls"><button aria-label="Minimize window" onClick={() => window.electronAPI.app.minimize()}><Minus size={15} /></button><button aria-label="Maximize window" onClick={() => window.electronAPI.app.maximize()}><Square size={12} /></button><button className="window-close" aria-label="Close window" onClick={() => window.electronAPI.app.close()}><X size={17} /></button></div></header>
    <aside className="sidebar"><nav>{sections.map(section => <div className="nav-section" key={section.label}><p>{section.label}</p>{section.items.map(({ label, path, Icon }) => <NavLink key={path} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to={path}><Icon size={18} strokeWidth={1.7} /><span>{label}</span>{path === '/sync' && unsynced > 0 && <span className="nav-badge">{unsynced}</span>}</NavLink>)}</div>)}<NavLink className={({ isActive }) => `nav-item settings-nav ${isActive ? 'active' : ''}`} to="/settings"><Settings size={18} strokeWidth={1.7} /><span>Settings</span></NavLink></nav><div className="sidebar-footer"><button onClick={() => { void updateSettings({ appearance: settings?.appearance === 'dark' ? 'light' : 'dark' }) }}>{settings?.appearance === 'dark' ? <Moon size={17} /> : <Sun size={17} />}<span>{settings?.appearance === 'dark' ? 'Dark mode' : 'Light mode'}</span></button><small>Everything worth remembering.</small></div></aside>
    <main className={`main-content${location.pathname === '/assistant' ? ' assistant-content' : ''}`}><Routes><Route path="/" element={<Navigate to="/sync" replace />} /><Route path="/sync" element={<SyncPage device={device} />} /><Route path="/today" element={<TodayPage />} /><Route path="/assistant" element={<AssistantPage />} /><Route path="/library" element={<LibraryPage />} /><Route path="/library/:id" element={<RecordingPage />} /><Route path="/projects" element={<ProjectsPage />} /><Route path="/actionables" element={<ActionablesPage />} /><Route path="/settings" element={<SettingsPage />} /></Routes></main>
    {error && <div className="error-toast" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={16} /></button></div>}
    <ActivityLog />
  </div>
}
export default function App(): JSX.Element { return <HashRouter><Shell /></HashRouter> }
