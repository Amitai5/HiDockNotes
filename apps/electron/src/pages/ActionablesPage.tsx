import { useEffect, useState } from 'react'
import type { ActionableView } from '../shared/contracts'
import { ActionableList } from '../components/ActionableList'
import { reportError } from '../store/useAppStore'

export function ActionablesPage(): JSX.Element {
  const [items, setItems] = useState<ActionableView[]>([])
  const [view, setView] = useState<'open' | 'completed'>('open')
  function refresh(): void { void window.electronAPI.actionables.list().then(setItems).catch(reportError) }
  useEffect(() => { refresh(); return window.electronAPI.library.onChanged(refresh) }, [])
  const open = items.filter(item => !item.done)
  const completed = items.filter(item => item.done)
  return <div className="page"><div className="page-heading"><div><h1>Actionables</h1><p>Turn your conversations into next steps.</p></div></div><div className="actionable-tabs" role="group" aria-label="Action item status"><button aria-pressed={view === 'open'} onClick={() => setView('open')}>Open <span>{open.length}</span></button><button aria-pressed={view === 'completed'} onClick={() => setView('completed')}>Completed <span>{completed.length}</span></button></div><ActionableList items={view === 'open' ? open : completed} onChanged={refresh} emptyText={view === 'completed' ? 'Completed action items will be kept here. Uncheck one to reopen it.' : completed.length ? 'You’re all caught up. Your completed items are saved in Completed.' : 'Action items appear here automatically after your recordings are summarized.'} /></div>
}
