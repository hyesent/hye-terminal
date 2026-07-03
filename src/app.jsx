import { useState, useEffect, useRef } from 'react'
import Header from './features/ui/Header.jsx'
import Terminal from './features/terminal/Terminal.jsx'

function App() {
  const themes = ['black', 'white', 'gogeta', 'classic']
  const [theme, setTheme] = useState('black')
  const terminalRef = useRef(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('hye-theme')
      if (saved && themes.includes(saved)) {
        setTheme(saved)
      }
    } catch {}
  }, [])

  const toggleTheme = () => {
    const currentIndex = themes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % themes.length
    const newTheme = themes[nextIndex]
    setTheme(newTheme)
    localStorage.setItem('hye-theme', newTheme)
  }

  // NEW: Handle import folder from header
  const handleImportFolder = () => {
    // Trigger the file picker in Terminal
    if (terminalRef.current?.openFilePicker) {
      terminalRef.current.openFilePicker()
    } else {
      // Fallback: send command
      terminalRef.current?.runCommand('hye import')
    }
  }

  return (
    <div className={`app-container theme-${theme}`}>
      <Header
        theme={theme}
        toggleTheme={toggleTheme}
        onCommand={(cmd) => terminalRef.current?.runCommand(cmd)}
        onImportFolder={handleImportFolder} // NEW prop
        onEsc={() => terminalRef.current?.runEsc()}
        onTab={() => terminalRef.current?.runTab()}
        onCtrlC={() => terminalRef.current?.runCtrlC()}
        onCtrlL={() => terminalRef.current?.runCtrlL()}
        onArrowUp={() => terminalRef.current?.runArrowUp()}
        onArrowDown={() => terminalRef.current?.runArrowDown()}
        onCtrlA={() => terminalRef.current?.runCtrlA()}
        onCtrlE={() => terminalRef.current?.runCtrlE()}
        onCtrlU={() => terminalRef.current?.runCtrlU()}
        onCtrlK={() => terminalRef.current?.runCtrlK()}
        onCtrlW={() => terminalRef.current?.runCtrlW()}
        onCtrlR={() => terminalRef.current?.runCtrlR()}
      />
      <Terminal ref={terminalRef} theme={theme} />
    </div>
  )
}

export default App
