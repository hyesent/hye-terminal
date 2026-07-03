import { useEffect, useState, useRef } from 'react'
import Menu from './Menu.jsx'
import HelpModal from './HelpModal'
import { Palette, ChevronDown, Plus, FolderOpen, FolderInput } from 'lucide-react'

function Header({ 
  theme, 
  toggleTheme,
  onCommand,
  onEsc, onTab, onCtrlC, onCtrlL, onArrowUp, onArrowDown,
  onCtrlA, onCtrlE, onCtrlU, onCtrlK, onCtrlW, onCtrlR,
  onImportFolder // NEW prop for folder picker
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [openMenuOpen, setOpenMenuOpen] = useState(false) // NEW
  const dropdownRef = useRef(null)
  const newRef = useRef(null)
  const openRef = useRef(null) // NEW

  const templates = ['react', 'vue', 'vanilla']

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShortcutOpen(false)
      }
      if (newRef.current && !newRef.current.contains(e.target)) {
        setNewMenuOpen(false)
      }
      if (openRef.current && !openRef.current.contains(e.target)) {
        setOpenMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleShortcutClick = (action) => {
    action()
    setShortcutOpen(false)
  }

  const handleNew = (template) => {
    setNewMenuOpen(false)
    const name = prompt(`Project name:`, `my-${template}-app`)
    if (name && name.trim()) {
      onCommand(`hye create ${template} ${name.trim()}`)
    }
  }

  const handleOpenProjects = () => {
    setOpenMenuOpen(false)
    onCommand('open') // Lists projects
  }

  const handleImportFolder = () => {
    setOpenMenuOpen(false)
    if (onImportFolder) {
      onImportFolder() // Triggers file picker
    } else {
      onCommand('hye import') // Fallback
    }
  }

  return (
    <>
      <header className="header">
        <div className="header-top">
          <div className="status-dot active"></div>
          <span className="header-title">HYE TERMINAL</span>
        </div>

        <div className="header-actions">
          {/* NEW BUTTON */}
          <div className="dropdown-wrapper" ref={newRef}>
            <button 
              className="header-btn primary"
              onClick={() => setNewMenuOpen(!newMenuOpen)}
            >
              <Plus size={14} /> New <ChevronDown size={12} />
            </button>
            {newMenuOpen && (
              <div className="dropdown-menu">
                {templates.map(t => (
                  <button 
                    key={t} 
                    className="dropdown-item"
                    onClick={() => handleNew(t)}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* OPEN DROPDOWN - Now with Import option */}
          <div className="dropdown-wrapper" ref={openRef}>
            <button 
              className="header-btn"
              onClick={() => setOpenMenuOpen(!openMenuOpen)}
            >
              <FolderOpen size={14} /> Open <ChevronDown size={12} />
            </button>
            
            {openMenuOpen && (
              <div className="dropdown-menu">
                <button className="dropdown-item" onClick={handleOpenProjects}>
                  <FolderOpen size={14} /> List Projects
                </button>
                <button className="dropdown-item" onClick={handleImportFolder}>
                  <FolderInput size={14} /> Import from Phone
                </button>
              </div>
            )}
          </div>

          {/* SHORTCUT DROPDOWN */}
          <div className="dropdown-wrapper" ref={dropdownRef}>
            <button 
              className="header-btn"
              onClick={() => setShortcutOpen(!shortcutOpen)}
            >
              Shortcut <ChevronDown size={14} />
            </button>
            
            {shortcutOpen && (
              <div className="shortcut-dropdown">
                <button className="term-btn" onClick={() => handleShortcutClick(onEsc)}>Esc</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onTab)}>Tab</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onCtrlC)}>Ctrl+C</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onCtrlL)}>Ctrl+L</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onArrowUp)}>↑</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onArrowDown)}>↓</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onCtrlA)}>Ctrl+A</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onCtrlE)}>Ctrl+E</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onCtrlU)}>Ctrl+U</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onCtrlK)}>Ctrl+K</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onCtrlW)}>Ctrl+W</button>
                <button className="term-btn" onClick={() => handleShortcutClick(onCtrlR)}>Ctrl+R</button>
              </div>
            )}
          </div>

          <button className="header-btn" onClick={() => setHelpOpen(true)}>Help</button>
          <button className="header-btn" onClick={() => setMenuOpen(true)}>Menu</button>
          <button className="header-btn icon-btn" onClick={toggleTheme} title="Switch theme">
            <Palette size={16} />
          </button>
        </div>
      </header>

      <Menu show={menuOpen} onClose={() => setMenuOpen(false)} theme={theme} />
      <HelpModal show={helpOpen} onClose={() => setHelpOpen(false)} theme={theme} />
    </>
  )
}

export default Header
