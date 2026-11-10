import { useEffect, useRef, useState } from 'react'
import { createHashRouter, RouterProvider, Navigate, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Activity, BookOpen, MessageSquare, Search, Settings, RefreshCw, X } from 'lucide-react'
import product from '../product.json'
import { useDevicePipeline } from './hooks/useDevicePipeline'
import { useDeviceSubscriptions } from './hooks/useDeviceSubscriptions'
import { reportError, useAppStore } from './store/useAppStore'
import { appClient } from './services/app-client'
import { ActivityLog } from './components/ActivityLog'
import { SyncPage, modelName } from './pages/SyncPage'
import { LibraryPage } from './pages/LibraryPage'
import { LibrarySidebar } from './components/LibrarySidebar'
import { LibraryNavigationProvider } from './hooks/useLibraryNavigation'
import { SettingsPage } from './pages/SettingsPage'
import { AssistantPage } from './pages/AssistantPage'
import { ResizableNavigation } from './components/ResizableNavigation'
import { BrandMark } from './components/BrandMark'
import { MobileNavigation } from './components/MobileNavigation'
import { useVisualViewport } from './hooks/useVisualViewport'
import { BrowserControls, SignOutButton } from './components/BrowserControls'
import { RecentChatsSidebar } from './components/RecentChatsSidebar'
import { WebUpdateNotice } from './components/WebUpdatesPanel'

const primary = [
  { label: 'Library', path: '/library', Icon: BookOpen },
  { label: 'Assistant', path: '/assistant', Icon: MessageSquare },
  { label: 'Sync', path: '/sync', Icon: RefreshCw }
]

function Shell(): JSX.Element {
  useVisualViewport()
  const device = useDevicePipeline()
  useDeviceSubscriptions()
  const settings = useAppStore(s => s.settings), search = useAppStore(s => s.search)
  const setSearch = useAppStore(s => s.setSearch), setActivityOpen = useAppStore(s => s.setActivityOpen)
  const error = useAppStore(s => s.error), setError = useAppStore(s => s.setError)
  const [jobs, setJobs] = useState(0)
  const searchInput = useRef<HTMLInputElement>(null)
  const navigate = useNavigate(), location = useLocation()
  const assistant = location.pathname === '/assistant'
  const connected = device.state.device !== null && !['disconnected', 'error'].includes(device.state.phase)
  const active = !['disconnected', 'idle', 'error'].includes(device.state.phase)
  const unsynced = device.files.filter(file => !file.localVerified && !file.active).length
  useEffect(() => {
    document.title = product.name
    const match = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = settings?.appearance === 'dark' || (settings?.appearance === 'system' && match.matches) ? 'dark' : 'light' }
    apply(); match.addEventListener('change', apply)
    return () => match.removeEventListener('change', apply)
  }, [settings?.appearance])
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus(); searchInput.current?.select() }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  useEffect(() => {
    let alive = true, revision = 0
    const refresh = (): void => {
      const current = ++revision
      void appClient.ai.getState().then(state => { if (alive && current === revision) setJobs(state.queue?.activeJobs?.length ?? (state.queue?.active ? 1 : 0)) }).catch(reportError)
    }
    refresh(); const off = appClient.library.onChanged(refresh)
    return () => { alive = false; off() }
  }, [])
  return <ResizableNavigation>
    <header className="titlebar">
      <Link className="brand" to="/library" aria-label="HiDockNotes Library"><BrandMark /><span>{product.name}</span></Link>
      <MobileNavigation items={primary} name={settings?.name} />
      <form className="global-search input-with-icon" onSubmit={event => { event.preventDefault(); navigate('/library') }}><Search size={16} /><input ref={searchInput} aria-label="Search your library" placeholder="Search your library" value={search} onChange={event => { setSearch(event.target.value); if (event.target.value) navigate('/library') }} /><kbd>Ctrl K</kbd></form>
      <div className="titlebar-actions">{connected && <Link to="/sync" className="device-chip connected"><span />{modelName(device.state.device?.model)} · {device.state.phase === 'idle' ? 'Ready' : device.state.downloadProgress ? `Syncing ${device.state.downloadProgress.current} of ${device.state.downloadProgress.total}` : device.state.phase}</Link>}<button className="activity-trigger" aria-label={jobs ? `Activity, ${jobs} jobs running` : 'Activity'} title="Activity" onClick={() => setActivityOpen(true)}><Activity size={17} className={active || jobs ? 'pulse-accent' : ''} />{jobs > 0 && <span className="activity-count">{jobs}</span>}</button><BrowserControls showSignOut={false} /></div>
    </header>
    <aside className="sidebar" id="navigation-sidebar" aria-label="Main navigation"><nav>
      <div className="nav-primary">{primary.map(({ label, path, Icon }) => <NavLink key={path} className={({ isActive }) => `nav-item ${isActive && (path !== '/library' || !location.search && location.pathname === '/library') ? 'active' : ''}`} to={path}><Icon size={16} strokeWidth={1.7} /><span>{label}</span>{path === '/sync' && unsynced > 0 && <small className="nav-count">{unsynced} new</small>}</NavLink>)}</div>
      {assistant ? <RecentChatsSidebar /> : <LibrarySidebar showLibrary={false} showCounts />}
      <div className="navigation-footer"><NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to="/settings"><Settings size={16} strokeWidth={1.7} /><span>Settings</span></NavLink><SignOutButton name={settings?.name} /></div>
    </nav></aside>
    <main className={`main-content${assistant ? ' assistant-content' : location.pathname === '/settings' ? ' settings-content' : location.pathname === '/library' || location.pathname.startsWith('/library/') || location.pathname.startsWith('/notes/') ? ' library-content' : ''}`}><Routes><Route path="/" element={<Navigate to="/library" replace />} /><Route path="/sync" element={<SyncPage device={device} />} /><Route path="/today" element={<Navigate to="/library" replace />} /><Route path="/assistant" element={<AssistantPage />} /><Route path="/library" element={<LibraryPage />} /><Route path="/notes/:noteId" element={<LibraryPage />} /><Route path="/library/:id" element={<LibraryPage />} /><Route path="/projects" element={<Navigate to="/library" replace />} /><Route path="/actionables" element={<Navigate to="/library" replace />} /><Route path="/settings" element={<SettingsPage />} /></Routes></main>
    {error && <div className="error-toast" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={16} /></button></div>}
    <WebUpdateNotice /><ActivityLog />
  </ResizableNavigation>
}
const router = createHashRouter([{ path: '*', element: <LibraryNavigationProvider><Shell /></LibraryNavigationProvider> }])
export default function App(): JSX.Element { return <RouterProvider router={router} /> }
