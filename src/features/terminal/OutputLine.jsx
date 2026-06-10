function OutputLine({ cwd, command, output, error }) {
  const isWindows = cwd.includes(':\\')
  const psPrefix = isWindows? 'PS ' : ''

  return (
    <div className="command-block">
      <div className="command-line">
        <span className="ps-prefix">{psPrefix}</span>
        <span className="path-segment">{cwd}</span>
        <span className="prompt-char">{'>'}</span>
        <span className="command-text">{command}</span>
      </div>
      
      {error && (
        <div className="output-content error">{error}</div>
      )}
      
      {output &&!error && (
        <div className="output-content">
          {Array.isArray(output) 
          ? output.join('\n') 
            : String(output)
          }
        </div>
      )}
    </div>
  )
}

export default OutputLine