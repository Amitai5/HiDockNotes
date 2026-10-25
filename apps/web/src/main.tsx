import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './notes.css'
import { AuthGate } from './components/AuthGate'
import { initializePwa } from './components/WebUpdatesPanel'

initializePwa()
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate><App /></AuthGate></React.StrictMode>)
