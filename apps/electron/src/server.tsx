import { createRoot } from 'react-dom/client'
import { ServerConnectionPanel } from './components/ServerConnectionPanel'
import { BrandMark } from './components/BrandMark'
import './server.css'
createRoot(document.getElementById('root')!).render(<main className="connection-page"><BrandMark size={64} /><h1>Connect HiDockNotes to your server</h1><ServerConnectionPanel /></main>)
