import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { registerPlugin } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import OutputLine from './OutputLine'
import Prompt from './Prompt'

const HyeShell = registerPlugin('HyeShell')
const HyeLinuxRuntime = registerPlugin('HyeLinuxRuntime')

async function readConfig() {
  try {
    const result = await Filesystem.readFile({ path: '.hyeconfig', directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(result.data)
  } catch { return {} }
}
async function writeConfig(config) {
  await Filesystem.writeFile({ path: '.hyeconfig', data: JSON.stringify(config), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })
}

const Terminal = forwardRef(({ theme, onCommand }, ref) => {
  const [blocks, setBlocks] = useState([])
  const [cwd, setCwd] = useState('')
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentInput, setCurrentInput] = useState('')
  const [wcBooted, setWcBooted] = useState(false)
  const [notification, setNotification] = useState(null)
  const [hint, setHint] = useState(null)
  const [showSetup, setShowSetup] = useState(false)
  const [setupName, setSetupName] = useState('')
  const [setupEmail, setSetupEmail] = useState('')
  const terminalRef = useRef(null)
  const promptInputRef = useRef(null)
  const homeRef = useRef('')
  const linuxHomeRef = useRef('')
  const linuxReadyRef = useRef(false)
  const cwdRef = useRef('')
  const activeProcessRef = useRef(null)
  const activeProcessIdsRef = useRef([])
  const processBlocksRef = useRef(new Map())
  const listenersRef = useRef([])

  const addBlock = (command, output, error = null) => setBlocks(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, cwd: cwdRef.current, command, output, error }])
  const fullPath = (path = cwdRef.current) => path ? (path.startsWith('/') ? path : `${homeRef.current}/${path}`).replace(/\/{2,}/g, '/') : homeRef.current
  const linuxPath = (path = cwdRef.current) => path ? (path.startsWith('/') ? path : `${linuxHomeRef.current}/${path}`).replace(/\/{2,}/g, '/') : linuxHomeRef.current
  const setDirectory = (next) => { cwdRef.current = next; setCwd(next) }

  useEffect(() => {
    let active = true
    const boot = async () => {
      setNotification({ type: 'booting', text: 'Starting local Android shell…' })
      try {
        const info = await HyeShell.home()
        if (!active) return
        homeRef.current = info.home
        try {
          if (window.localStorage.getItem('hye-linux-installed') === '1') {
            const runtime = await HyeLinuxRuntime.install()
            if (runtime.ready && runtime.home) {
              linuxReadyRef.current = true
              linuxHomeRef.current = runtime.home
            }
          }
        } catch (runtimeError) {
          setNotification({ type: 'error', text: `Linux runtime could not start: ${runtimeError.message}` })
        }
        const config = await readConfig()
        if (!linuxReadyRef.current) setNotification({ type: 'success', text: 'Local Android shell ready — install Linux for full Bash and packages' })
        setHint('Commands run on this device. Type help for details.')
        setTimeout(() => { if (active) { setNotification(null); setHint(null) } }, 5000)
        setWcBooted(true)
        if (!config['user.name'] || !config['user.email']) setShowSetup(true)
      } catch (error) {
        setNotification({ type: 'error', text: `Local shell unavailable: ${error.message}` })
      }
    }
    boot()
    const onOutput = event => {
      const blockId = processBlocksRef.current.get(event.processId)
      if (!blockId) {
        const id = `process-${event.processId}`
        processBlocksRef.current.set(event.processId, id)
        setBlocks(prev => [...prev, { id, cwd: event.cwd || cwdRef.current, command: event.command || `[process ${event.processId}]`, output: event.stream === 'stdout' ? event.data : '', error: event.stream === 'stderr' ? event.data : '' }])
      } else {
        setBlocks(prev => prev.map(block => block.id !== blockId ? block : ({
          ...block,
          output: event.stream === 'stdout' ? `${block.output || ''}${event.data}` : block.output,
          error: event.stream === 'stderr' ? `${block.error || ''}${event.data}` : block.error
        })))
      }
    }
    const onExit = event => {
      const blockId = processBlocksRef.current.get(event.processId)
      if (blockId) setBlocks(prev => prev.map(block => block.id !== blockId ? block : ({
        ...block,
        output: `${block.output || ''}${block.output ? '\n' : ''}[process ${event.processId} exited with code ${event.exitCode}]`,
        error: event.exitCode === 0 ? block.error : `${block.error || ''}${block.error ? '\n' : ''}exit code ${event.exitCode}`
      })))
      else addBlock(`[process ${event.processId}]`, `[process exited with code ${event.exitCode}]`, event.exitCode === 0 ? null : `exit code ${event.exitCode}`)
      activeProcessIdsRef.current = activeProcessIdsRef.current.filter(id => id !== event.processId)
      activeProcessRef.current = activeProcessIdsRef.current.length ? activeProcessIdsRef.current[activeProcessIdsRef.current.length - 1] : null
      setIsProcessing(false)
    }
    const outputListener = HyeShell.addListener('output', onOutput)
    const exitListener = HyeShell.addListener('exit', onExit)
    const linuxOutputListener = HyeLinuxRuntime.addListener('output', onOutput)
    const linuxExitListener = HyeLinuxRuntime.addListener('exit', onExit)
    listenersRef.current = [outputListener, exitListener, linuxOutputListener, linuxExitListener]
    return () => { active = false; listenersRef.current.forEach(p => p?.then?.(l => l.remove())) }
  }, [])

  useEffect(() => { terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' }) }, [blocks])

  useImperativeHandle(ref, () => ({
    runCommand: handleCommand,
    runEsc: () => { setCurrentInput(''); setHistoryIndex(-1); promptInputRef.current?.focus() },
    runTab: () => {},
    runCtrlC: async () => { if (activeProcessRef.current) { const id = activeProcessRef.current; if (String(id).startsWith('linux-')) await HyeLinuxRuntime.kill({ processId: id }); else await HyeShell.kill({ processId: id }) } else addBlock(currentInput, null, '^C'); setCurrentInput('') },
    runCtrlL: () => setBlocks([]),
    runArrowUp: () => { if (!history.length) return; const i = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex; setHistoryIndex(i); setCurrentInput(history[history.length - 1 - i]) },
    runArrowDown: () => { if (historyIndex <= 0) { setHistoryIndex(-1); setCurrentInput(''); return }; const i = historyIndex - 1; setHistoryIndex(i); setCurrentInput(history[history.length - 1 - i]) },
    runCtrlA: () => {}, runCtrlE: () => {}, runCtrlU: () => setCurrentInput(''), runCtrlK: () => {}, runCtrlW: () => {}, runCtrlR: () => {},
    openFilePicker: handleOpenPicker
  }))

  async function handleOpenPicker() {
    try {
      const input = document.createElement('input'); input.type = 'file'; input.webkitdirectory = true; input.multiple = true
      input.onchange = async e => {
        const files = Array.from(e.target.files || [])
        if (!files.length) return
        const folder = files[0].webkitRelativePath.split('/')[0]
        addBlock('', `Importing ${folder} (${files.length} files)…`)
        for (const file of files) {
          const rel = file.webkitRelativePath.split('/').slice(1).join('/')
          const path = linuxReadyRef.current ? `${linuxPath()}/${folder}/${rel}` : `${fullPath()}/${folder}/${rel}`
          const data = await file.arrayBuffer()
          const bytes = new Uint8Array(data)
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          if (linuxReadyRef.current) await HyeLinuxRuntime.writeFile({ path, base64: btoa(binary) })
          else await HyeShell.writeFile({ path, base64: btoa(binary) })
        }
        addBlock('', `Imported ${files.length} files into ${folder}/`)
      }
      input.click()
    } catch (error) { addBlock('', null, `Import failed: ${error.message}`) }
  }

  function shellQuote(value) { return `'${String(value).replace(/'/g, "'\\''")}'` }

  async function handleCommand(input) {
    if (!input.trim() || !wcBooted) return
    setHint(null); setCurrentInput(''); setHistory(prev => [...prev, input]); setHistoryIndex(-1)
    const trimmed = input.trim()
    const [command, ...args] = trimmed.split(/\s+/)
    if (command === 'clear') { setBlocks([]); return }
    if (command === 'help') {
      addBlock(input, `HYE TERMINAL — LOCAL SHELL\n\nEnvironment: ${linuxReadyRef.current ? `embedded Linux (${linuxHomeRef.current})` : 'Android host shell (install Linux for Bash, packages and dev servers)'}\nNo remote command backend.\n\nNormal commands run directly: ls, pwd, cd, grep, find, git, bash, python, node, npm, etc.\nWhen Linux is installed, normal commands execute inside Linux without an hye prefix.\nLong-running commands and local servers stream output while running.\nExamples: pkg update && pkg install git nodejs python; npm run dev; python -m http.server 8080\n\ncd <dir>              Change directory\npwd                   Print working directory\nCtrl+C                Stop the most recently started process\nhye runtime status     Check embedded Linux runtime status\nhye runtime install    Install/init embedded Linux userspace\npkg install <names>    Install packages through the Linux package manager\nhye import             Import a folder from device\n\nLinux must be installed once before Linux-only tools such as Bash, pkg, Git, Node.js or Python are available.`)
      return
    }
    if (command === 'hye' && args[0] === 'config') {
      const cfg = await readConfig(); const sub = args[1]
      if (!sub || sub === '--list') { addBlock(input, `user.name: ${cfg['user.name'] || '(not set)'}\nuser.email: ${cfg['user.email'] || '(not set)'}`); return }
      if (sub === 'user.name' || sub === 'user.email') {
        const value = args.slice(2).join(' ').replace(/^['"]|['"]$/g, '')
        if (!value || (sub === 'user.email' && !value.includes('@'))) { addBlock(input, null, `Usage: hye config ${sub} "value"`); return }
        cfg[sub] = value; await writeConfig(cfg); addBlock(input, `${sub} set to ${value}`); return
      }
      if (sub === '--reset') { delete cfg['user.name']; delete cfg['user.email']; await writeConfig(cfg); addBlock(input, 'Git identity cleared'); return }
      addBlock(input, null, `Unknown config option: ${sub}`); return
    }
    if (command === 'hye' && args[0] === 'import') { await handleOpenPicker(); return }
    if (command === 'hye' && args[0] === 'runtime') {
      const action = args[1] || 'status'
      try {
        if (action === 'status') {
          const status = await HyeLinuxRuntime.status()
          addBlock(input, `Embedded Linux runtime\nState: ${status.state}\nInitialized: ${status.ready ? 'yes' : 'no'}\nArchitecture: ${status.architecture}\nSDK: ${status.sdk}${status.error ? `\nError: ${status.error}` : ''}`)
          return
        }
        if (action === 'install') {
          addBlock(input, 'Installing the embedded Linux userspace. First setup needs an internet connection and storage; keep HYE Terminal open.')
          const result = await HyeLinuxRuntime.install()
          linuxHomeRef.current = result.home || ''
          linuxReadyRef.current = Boolean(result.ready && result.home)
          if (linuxReadyRef.current) {
            window.localStorage.setItem('hye-linux-installed', '1')
            setDirectory('')
          }
          addBlock('', `Linux runtime state: ${result.state}. Home: ${linuxHomeRef.current || '(unknown)'}. Install tools with the normal command \`pkg install git nodejs python\`.`)
          return
        }
        if (action === 'test') {
          const checks = ['uname -a', 'printf "HOME=%s\\n" "$HOME"', 'command -v bash', 'command -v pkg']
          const output = []
          for (const check of checks) {
            try {
              const result = await HyeLinuxRuntime.run({ command: check })
              output.push(`$ ${check}\n${result.stdout || '(no output)'}`)
            } catch (error) { output.push(`$ ${check}\nFAILED: ${error.message}`) }
          }
          addBlock(input, output.join('\n\n'))
          return
        }
        addBlock(input, null, 'Usage: hye runtime status | install | test')
      } catch (error) {
        addBlock(input, null, `Linux runtime setup failed: ${error.message}`)
      }
      return
    }
    if (command === 'cd') {
      const target = args.join(' ') || '~'
      try {
        if (linuxReadyRef.current) {
          const current = linuxPath()
          const destination = !target || target === '~' ? linuxHomeRef.current : target.startsWith('/') ? target : target.startsWith('~/') ? `${linuxHomeRef.current}/${target.slice(2)}` : `${current}/${target}`
          const result = await HyeLinuxRuntime.run({ command: `cd ${shellQuote(current)} && cd ${shellQuote(destination)} && pwd` })
          const next = String(result.stdout || '').trim().split('\n').pop()
          if (!next.startsWith('/')) throw new Error(`Invalid directory response: ${next}`)
          setDirectory(next === linuxHomeRef.current ? '' : next.startsWith(linuxHomeRef.current + '/') ? next.slice(linuxHomeRef.current.length + 1) : next)
          addBlock(input, next)
        } else {
          const requested = target === '~' ? homeRef.current : target.startsWith('/') ? target : `${fullPath()}/${target}`
          const result = await HyeShell.checkDirectory({ path: requested })
          const next = result.path
          setDirectory(next === homeRef.current ? '' : next.replace(homeRef.current + '/', '').replace(/^\/+/, ''))
          addBlock(input, next)
        }
      } catch (e) { addBlock(input, null, e.message) }
      return
    }
    if (command === 'pwd') {
      if (linuxReadyRef.current) {
        try { const result = await HyeLinuxRuntime.run({ command: `cd ${shellQuote(linuxPath())} && pwd` }); addBlock(input, String(result.stdout || linuxPath()).trim()) }
        catch (e) { addBlock(input, null, e.message) }
      } else addBlock(input, fullPath())
      return
    }
    if (command === 'hye') { addBlock(input, null, 'Unknown local command. Type help.'); return }
    if (command === 'open') { input = 'ls -la'; }
    if (command === 'path') { addBlock(input, linuxReadyRef.current ? linuxPath() : fullPath()); return }
    setIsProcessing(true)
    try {
      const started = linuxReadyRef.current
        ? await HyeLinuxRuntime.execute({ command: input, cwd: linuxPath() })
        : await HyeShell.execute({ command: input, cwd: fullPath() })
      activeProcessIdsRef.current = [...activeProcessIdsRef.current.filter(id => id !== started.processId), started.processId]
      activeProcessRef.current = started.processId
      const blockId = processBlocksRef.current.get(started.processId) || `process-${started.processId}`
      if (!processBlocksRef.current.has(started.processId)) {
        processBlocksRef.current.set(started.processId, blockId)
        setBlocks(prev => [...prev, { id: blockId, cwd: started.cwd || (linuxReadyRef.current ? linuxPath() : fullPath()), command: input, output: '', error: '' }])
      }
      setIsProcessing(false)
    } catch (error) {
      setIsProcessing(false); addBlock(input, null, error.message)
    }
    if (typeof onCommand === 'function') onCommand(input)
  }

  const saveSetup = async () => {
    if (!setupName.trim() || !setupEmail.includes('@')) return
    const cfg = await readConfig(); cfg['user.name'] = setupName.trim(); cfg['user.email'] = setupEmail.trim(); await writeConfig(cfg); setShowSetup(false)
    addBlock('', 'Git identity saved locally. Configure Git if the git executable is available.')
  }

  return (
    <div className="terminal" ref={terminalRef} data-theme={theme}>
      {notification && <div className={`terminal-notification ${notification.type}`}>{notification.text}</div>}
      {hint && wcBooted && <div className="terminal-hint">{hint}</div>}
      <div className="terminal-lines">{blocks.map(block => <OutputLine key={block.id} cwd={block.cwd} command={block.command} output={block.output} error={block.error} />)}</div>
      <Prompt ref={promptInputRef} cwd={cwd} onSubmit={handleCommand} history={history} historyIndex={historyIndex} setHistoryIndex={setHistoryIndex} disabled={!wcBooted} theme={theme} value={currentInput} onChange={setCurrentInput} />
      {showSetup && <div className="setup-overlay" style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}><div className="setup-modal" style={{ background:'#1e1e1e', padding:24, borderRadius:8, border:'1px solid #3c3c3c', maxWidth:400, width:'90%' }}><h3 style={{color:'#58a6ff'}}>Setup Git Identity</h3><p style={{color:'#ccc',fontSize:13}}>Stored on this device only.</p><input placeholder="Your Name" value={setupName} onChange={e=>setSetupName(e.target.value)} style={inputStyle}/><input type="email" placeholder="Your Email" value={setupEmail} onChange={e=>setSetupEmail(e.target.value)} style={inputStyle}/><button onClick={saveSetup} style={{marginTop:12,padding:10,width:'100%'}}>Save identity</button><button onClick={()=>setShowSetup(false)} style={{marginTop:8,padding:8,width:'100%'}}>Skip</button></div></div>}
    </div>
  )
})

const inputStyle = { width:'100%', padding:8, marginBottom:12, background:'#0a0a0a', border:'1px solid #3c3c3c', color:'#eee', borderRadius:4, boxSizing:'border-box' }
export default Terminal
