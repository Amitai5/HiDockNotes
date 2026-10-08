import { useEffect, useState } from 'react'
import { ListChecks } from 'lucide-react'
import type { ActionableView } from '../shared/contracts'
import { EmptyState } from '../components/ui'
import { ActionableList } from '../components/ActionableList'
import { reportError } from '../store/useAppStore'

export function ActionablesPage(): JSX.Element {
  const [items, setItems] = useState<ActionableView[]>([])
  function refresh(): void { void window.electronAPI.actionables.list().then(setItems).catch(reportError) }
  useEffect(() => { refresh(); return window.electronAPI.library.onChanged(refresh) }, [])
  return <div className="page"><div className="page-heading"><div><h1>Actionables</h1><p>Turn your conversations into next steps.</p></div></div>{items.length ? <ActionableList items={items} onChanged={refresh} /> : <EmptyState icon={<ListChecks size={30} />} title="Nothing on your list">Action items appear here automatically after your recordings are transcribed and summarized.</EmptyState>}</div>
}
