import React from 'react'

const ANSI_COLORS = {
  30: '#111827', 31: '#ff6b6b', 32: '#51cf66', 33: '#ffd43b', 34: '#74c0fc',
  35: '#da77f2', 36: '#66d9e8', 37: '#f1f3f5', 90: '#868e96', 91: '#ff8787',
  92: '#8ce99a', 93: '#ffe066', 94: '#a5d8ff', 95: '#eebefa', 96: '#99e9f2', 97: '#ffffff'
}

function renderAnsi(text) {
  const parts = []
  const re = /\x1b\[([0-9;]*)m/g
  let cursor = 0
  let style = {}
  let match
  let index = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) parts.push(<span key={index++} style={style}>{text.slice(cursor, match.index)}</span>)
    const codes = (match[1] || '0').split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]
      if (code === 0) style = {}
      else if (code === 1) style = { ...style, fontWeight: 700 }
      else if (code === 2) style = { ...style, opacity: 0.75 }
      else if (code === 3) style = { ...style, fontStyle: 'italic' }
      else if (code === 4) style = { ...style, textDecoration: 'underline' }
      else if (code === 22) { const { fontWeight, opacity, ...rest } = style; style = rest }
      else if (code === 23) { const { fontStyle, ...rest } = style; style = rest }
      else if (code === 24) { const { textDecoration, ...rest } = style; style = rest }
      else if (code === 39) { const { color, ...rest } = style; style = rest }
      else if (code === 49) { const { backgroundColor, ...rest } = style; style = rest }
      else if (ANSI_COLORS[code]) style = { ...style, color: ANSI_COLORS[code] }
      else if (code >= 40 && code <= 47) style = { ...style, backgroundColor: ANSI_COLORS[code - 10] }
      else if (code >= 100 && code <= 107) style = { ...style, backgroundColor: ANSI_COLORS[code - 10] }
    }
    cursor = re.lastIndex
  }
  if (cursor < text.length) parts.push(<span key={index++} style={style}>{text.slice(cursor)}</span>)
  return parts.length ? parts : text
}

function OutputLine({ cwd = '', command, output, error }) {
  const isWindows = cwd.includes(':\\')
  const psPrefix = isWindows ? 'PS ' : ''
  return (
    <div className="command-block">
      {command !== undefined && command !== null && command !== '' && <div className="command-line">
        <span className="ps-prefix">{psPrefix}</span><span className="path-segment">{cwd}</span>
        <span className="prompt-char">{'>'}</span><span className="command-text">{command}</span>
      </div>}
      {error && <div className="output-content error">{renderAnsi(String(error))}</div>}
      {output !== undefined && output !== null && output !== '' && <div className="output-content">{renderAnsi(Array.isArray(output) ? output.join('\n') : String(output))}</div>}
    </div>
  )
}
export default OutputLine
