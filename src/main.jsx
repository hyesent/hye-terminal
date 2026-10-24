import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app.jsx'
import { Buffer } from 'buffer'
window.Buffer = Buffer
window.global = window.globalThis
import './styles/mainTerminal.css'
import './styles/themes.css'
import './features/ui/Header.css'
import './features/terminal/Terminal.css'
import './features/ui/Menu.css'
import './features/ui/HelpModal.css'

const root = document.getElementById('root')

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} else {
  console.error('Root element not found')
}