import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

import './styles/terminal.css'
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