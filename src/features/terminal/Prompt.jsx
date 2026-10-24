import { forwardRef, useEffect } from 'react'

const Prompt = forwardRef(({
  cwd,
  onSubmit,
  history,
  historyIndex,
  setHistoryIndex,
  disabled,
  theme,
  value,
  onChange
}, ref) => {
  const isWindows = cwd.includes(':\\')
  const psPrefix = isWindows? 'PS ' : ''

  useEffect(() => {
    ref?.current?.focus()
  }, [ref])

  const handleKeyDown = (e) => {
    if (disabled) return

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!history.length) return
      const newIndex = historyIndex === -1? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(newIndex)
      onChange(history[newIndex] || '')
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex === -1) return
      const newIndex = historyIndex + 1
      if (newIndex >= history.length) {
        setHistoryIndex(-1)
        onChange('')
      } else {
        setHistoryIndex(newIndex)
        onChange(history[newIndex] || '')
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      handleTabComplete()
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (value.trim()) {
        onSubmit(value.trim())
        onChange('')
      }
    }
  }

  // Basic command completion for the local Android shell.
  const handleTabComplete = () => {
    const input = value.toLowerCase().trim()

    // Common shell commands; availability depends on the local Android environment.
    const LOCAL_COMMANDS = [
      'ls', 'cd', 'mkdir', 'cat', 'echo', 'touch', 'rm', 'pwd', 'find', 'grep', 'sed', 'awk',
      'git status', 'git log', 'git clone', 'npm install', 'npm run', 'python', 'node', 'clear', 'help'
    ]

    const matches = LOCAL_COMMANDS.filter(cmd => cmd.startsWith(input))

    if (matches.length === 1) {
      onChange(matches[0] + ' ')
    } else if (matches.length > 1) {
      // Show suggestions - Terminal will handle this
      onSubmit(`__TAB_COMPLETE__ ${matches.join(', ')}`)
    }
  }

  return (
    <div className="prompt-container">
      <div className="prompt-line">
        <span className="ps-prefix">{psPrefix}</span>
        <span className="path-segment">{cwd}</span>
        <span className="prompt-char">{'>'}</span>

        <input
          ref={ref}
          className="prompt-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder={disabled? "Booting..." : ""}
        />
      </div>
    </div>
  )
})

Prompt.displayName = 'Prompt'
export default Prompt