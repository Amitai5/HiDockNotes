import { useEffect, useState } from 'react'
import { History, Plus } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { appClient } from '../services/app-client'
import { randomId } from '../shared/ids'
import type { ConversationView } from '../shared/conversations'
import { reportError } from '../store/useAppStore'

export function RecentChatsSidebar(): JSX.Element {
  const [chats, setChats] = useState<ConversationView[]>([]), [selected, setSelected] = useState<string | null>(null)
  const location = useLocation()
  useEffect(() => {
    let alive = true, revision = 0
    const load = (): void => {
      const current = ++revision
      void Promise.all([appClient.conversations.list(''), appClient.conversations.current()]).then(([items, active]) => {
        if (alive && current === revision) { setChats(items.slice(0, 6)); setSelected(new URLSearchParams(location.search).has('new') ? null : new URLSearchParams(location.search).get('chat') ?? active?.conversation.id ?? null) }
      }).catch(reportError)
    }
    load(); const off = appClient.conversations.onChanged(load)
    return () => { alive = false; off() }
  }, [location.search])
  return <section className="recent-chats" aria-label="Recent chats"><div className="library-project-label"><span>Recent chats</span><Link className="button button-ghost" to={'/assistant?new=' + randomId()} aria-label="Start new chat"><Plus size={15} /></Link></div>{chats.map(chat => <Link key={chat.id} className={`nav-item recent-chat ${chat.id === selected ? 'active' : ''}`} to={'/assistant?chat=' + encodeURIComponent(chat.id)} title={chat.title}><span>{chat.title}</span></Link>)}{!chats.length && <p className="recent-chat-empty">Your saved chats appear here.</p>}<Link className="nav-item" to="/assistant?history=1"><History size={15} /><span>All chats</span></Link></section>
}
