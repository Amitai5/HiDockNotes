import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { Menu, Settings, X, type LucideIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { LibrarySidebar } from './LibrarySidebar'
import { SignOutButton } from './BrowserControls'
import { Button } from './ui'

export function MobileNavigation({ items, name }: { items: { label: string; path: string; Icon: LucideIcon }[]; name?: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  useEffect(() => { setOpen(false) }, [location.key])
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><Button className="mobile-navigation-trigger" variant="ghost" aria-label="Open navigation"><Menu size={21} /></Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay mobile-navigation-overlay" /><Dialog.Content className="mobile-navigation-drawer" aria-describedby={undefined}>
      <header><Dialog.Title>Navigation</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close navigation"><X size={21} /></Button></Dialog.Close></header>
      <nav aria-label="Mobile navigation" onClick={event => { if ((event.target as Element).closest('a')) setOpen(false) }}>
        <div className="nav-primary">{items.map(({ label, path, Icon }) => <NavLink key={path} className={({ isActive }) => `nav-item ${isActive && (path !== '/library' || !location.search && location.pathname === '/library') ? 'active' : ''}`} to={path}><Icon size={20} /><span>{label}</span></NavLink>)}</div>
        <LibrarySidebar showLibrary={false} showCounts />
      </nav>
      <footer><NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to="/settings" onClick={() => setOpen(false)}><Settings size={20} /><span>Settings</span></NavLink><SignOutButton name={name || 'Your account'} /></footer>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
