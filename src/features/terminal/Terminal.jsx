import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { WebContainer } from '@webcontainer/api'
import { Filesystem, Directory } from '@capacitor/filesystem'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import FS from '@isomorphic-git/lightning-fs'
import OutputLine from './OutputLine'
import Prompt from './Prompt'

let webcontainerInstance = null
const fs = new FS('fs')
const HYE_API = 'https://hye-api.onrender.com'
const isNative = window.Capacitor?.isNativePlatform?.() || false

const Terminal = forwardRef(({ theme, onCommand }, ref) => {
  const [blocks, setBlocks] = useState([])
  const [cwd, setCwd] = useState('/HYE-Projects')
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentInput, setCurrentInput] = useState('')
  const [wcBooted, setWcBooted] = useState(false)
  const [notification, setNotification] = useState(null)
  const [hint, setHint] = useState(null)

  const terminalRef = useRef(null)
  const promptInputRef = useRef(null)
  const wcRef = useRef(null)
  const hasBooted = useRef(false)

  // Backend exec for Android
  const runBackendExec = async (cmd, projectName = '') => {
    try {
      const res = await fetch(`${HYE_API}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, projectName, cwd: cwd.replace('/HYE-Projects', '') })
      })
      return await res.json()
    } catch (e) {
      return { stdout: '', stderr: `Network error: ${e.message}`, code: 1 }
    }
  }

  const getProjectName = () => {
    if (cwd === '/HYE-Projects') return ''
    return cwd.split('/').pop()
  }

  useEffect(() => {
    if (hasBooted.current) return
    hasBooted.current = true

    const boot = async () => {
      setNotification({ type: 'booting', text: 'Booting HYE Terminal...' })

      if (isNative) {
        try {
          const perm = await Filesystem.checkPermissions()
          if (perm.publicStorage!== 'granted') await Filesystem.requestPermissions()
          try {
            await Filesystem.readdir({ path: 'HYE-Projects', directory: Directory.ExternalStorage })
          } catch {
            await Filesystem.mkdir({ path: 'HYE-Projects', directory: Directory.ExternalStorage, recursive: true })
          }
        } catch (e) { console.error('Filesystem error:', e) }
        setNotification({ type: 'success', text: '🟢 Terminal ready - Backend mode' })
        setTimeout(() => setNotification(null), 4000)
        setHint('💡 Type "help" for commands')
        setTimeout(() => setHint(null), 10000)
        setWcBooted(true)
        return
      }

      // Web: boot WebContainer
      if (!webcontainerInstance) webcontainerInstance = await WebContainer.boot()
      wcRef.current = webcontainerInstance

      try { await wcRef.current.fs.readdir('/home') }
      catch { await wcRef.current.fs.mkdir('/home', { recursive: true }) }

      setNotification({ type: 'success', text: '🟢 Terminal ready with git + npm + npx' })
      setTimeout(() => setNotification(null), 4000)
      setHint('💡 Type "help" for commands')
      setTimeout(() => setHint(null), 10000)
      setWcBooted(true)
    }
    boot()
  }, [])

  const scrollToBottom = () => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' })
  }
  useEffect(scrollToBottom, [blocks])

  useImperativeHandle(ref, () => ({
    runCommand: (cmd) => handleCommand(cmd),
    runEsc: () => { setCurrentInput(''); setHistoryIndex(-1); promptInputRef.current?.focus() },
    runCtrlL: () => setBlocks([]),
    runCtrlC: () => { addBlock(currentInput, null, '^C'); setCurrentInput(''); setHistoryIndex(-1) },
    runArrowUp: () => {
      if (history.length === 0) return
      const newIndex = historyIndex < history.length - 1? historyIndex + 1 : historyIndex
      setHistoryIndex(newIndex)
      setCurrentInput(history[history.length - 1 - newIndex])
    },
    runArrowDown: () => {
      if (historyIndex <= 0) { setHistoryIndex(-1); setCurrentInput(''); return }
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setCurrentInput(history[history.length - 1 - newIndex])
    }
  }))

  const addBlock = (command, output, error = null) => {
    setBlocks(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, cwd, command, output, error }])
  }

  const getPackageSize = async (pkg) => {
    try {
      const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`)
      const data = await res.json()
      return Math.round((data.dist?.unpackedSize || 0) / 1024 / 1024)
    } catch { return 0 }
  }

  const syncToPhone = async (projectPath) => {
    if (!isNative) return
    try {
      const files = await wcRef.current.fs.readdir(projectPath, { withFileTypes: true })
      for (const file of files) {
        const fullPath = `${projectPath}/${file.name}`
        if (file.isDirectory()) {
          try {
            await Filesystem.mkdir({
              path: `HYE-Projects/${fullPath.replace('/home/', '')}`,
              directory: Directory.ExternalStorage,
              recursive: true
            })
          } catch {}
          await syncToPhone(fullPath)
        } else {
          const content = await wcRef.current.fs.readFile(fullPath, 'utf-8')
          await Filesystem.writeFile({
            path: `HYE-Projects/${fullPath.replace('/home/', '')}`,
            data: content,
            directory: Directory.ExternalStorage,
            recursive: true
          })
        }
      }
    } catch (e) {}
  }

  const syncWCtoLFS = async (dir) => {
    try {
      const files = await wcRef.current.fs.readdir(dir, { withFileTypes: true })
      await fs.promises.mkdir(dir, { recursive: true })
      for (const file of files) {
        const fullPath = `${dir}/${file.name}`
        if (file.isDirectory()) {
          await syncWCtoLFS(fullPath)
        } else {
          const content = await wcRef.current.fs.readFile(fullPath, 'utf-8')
          await fs.promises.writeFile(fullPath, content)
        }
      }
    } catch {}
  }

  const handleCommand = async (input) => {
    if (!input.trim() ||!wcBooted) return
    setHint(null)
    setIsProcessing(true)
    setCurrentInput('')
    const newHistory = [...history, input]
    setHistory(newHistory)
    setHistoryIndex(-1)

    const [command,...args] = input.trim().split(/\s+/)
    const fullPath = cwd === '/HYE-Projects'? '/home' : `/home${cwd.replace('/HYE-Projects', '')}`

    // HYE CREATE - works on both
    if (command === 'hye' && args[0] === 'create') {
      const template = args[1]
      const projectName = args[2] || `my-${template}-app`
      const TEMPLATES = { 'react': '2MB', 'vue': '1.8MB', 'vanilla': '800KB', 'express': '1MB', 'nextjs': '8MB' }
      if (!TEMPLATES[template]) {
        addBlock(input, null, `Template not found. Available: react, vue, vanilla, express, nextjs`)
        setIsProcessing(false)
        return
      }
      addBlock(input, `📦 Creating ${template} project... ${TEMPLATES[template]}`, null)

      if (isNative) {
        // Native: just create folders locally
        try {
          await Filesystem.mkdir({ path: `HYE-Projects/${projectName}`, directory: Directory.ExternalStorage, recursive: true })
          await Filesystem.writeFile({
            path: `HYE-Projects/${projectName}/package.json`,
            data: JSON.stringify({ name: projectName, version: '1.0.0', scripts: { dev: 'vite', build: 'vite build' } }, null, 2),
            directory: Directory.ExternalStorage
          })
          await Filesystem.mkdir({ path: `HYE-Projects/${projectName}/src`, directory: Directory.ExternalStorage, recursive: true })
          await Filesystem.writeFile({
            path: `HYE-Projects/${projectName}/src/App.jsx`,
            data: `export default () => <h1>${template}</h1>`,
            directory: Directory.ExternalStorage
          })
          addBlock('', `✅ Created /HYE-Projects/${projectName}/`, null)
          addBlock('', `💾 Saved to YOUR phone storage`, null)
          setCwd(`/HYE-Projects/${projectName}`)
        } catch (e) {
          addBlock('', null, `Error: ${e.message}`)
        }
      } else {
        // Web: use WebContainer
        try {
          await wcRef.current.fs.mkdir(`/home/${projectName}`, { recursive: true })
          await wcRef.current.fs.writeFile(`/home/${projectName}/package.json`, JSON.stringify({
            name: projectName, version: '1.0.0', scripts: { dev: 'vite', build: 'vite build' }
          }, null, 2))
          await wcRef.current.fs.mkdir(`/home/${projectName}/src`, { recursive: true })
          await wcRef.current.fs.writeFile(`/home/${projectName}/src/App.jsx`, `export default () => <h1>${template}</h1>`)
          await wcRef.current.fs.writeFile(`/home/${projectName}/index.html`, `<!DOCTYPE html><html><head><title>${projectName}</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`)
          await wcRef.current.fs.writeFile(`/home/${projectName}/src/main.jsx`, `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App.jsx'\n\nReactDOM.createRoot(document.getElementById('root')).render(<App />)`)
          await syncToPhone(`/home/${projectName}`)
          addBlock('', `✅ Created /HYE-Projects/${projectName}/`, null)
          addBlock('', `💾 Saved to YOUR phone storage`, null)
          setCwd(`/HYE-Projects/${projectName}`)
        } catch (e) {
          addBlock('', null, `Error: ${e.message}`)
        }
      }
      setIsProcessing(false)
      return
    }

    // OPEN
    if (command === 'open') {
      if (isNative) {
        try {
          const result = await Filesystem.readdir({ path: 'HYE-Projects', directory: Directory.ExternalStorage })
          addBlock(input, 'Projects:', null)
          result.files.forEach(f => addBlock('', ` ${f.name}`, null))
        } catch {
          addBlock(input, null, 'No projects. Create one: hye create react myapp')
        }
      } else {
        try {
          const dir = await wcRef.current.fs.readdir('/home')
          addBlock(input, 'Projects:', null)
          dir.forEach(d => addBlock('', ` ${d}`, null))
        } catch {
          addBlock(input, null, 'No projects. Create one: hye create react myapp')
        }
      }
      setIsProcessing(false)
      return
    }

    // NPM COMMANDS - Backend on Android, WC on web
    if (command === 'npm') {
      if (isNative) {
        addBlock(input, `Running: ${input}`, null)
        const result = await runBackendExec(input, getProjectName())
        if (result.stdout) addBlock('', result.stdout.trim(), null)
        if (result.stderr) addBlock('', null, result.stderr.trim())
        if (result.code === 0) addBlock('', '✅ Done', null)
      } else {
        // Your existing WebContainer npm logic
        if (args[0] === 'install' && args[1]) {
          const pkg = args[1]?.replace(/@.*/, '')
          const sizeMB = await getPackageSize(pkg)
          addBlock(input, `Checking ${pkg}... ${sizeMB}MB`, null)
          if (sizeMB > 500) {
            addBlock('', null, `🛑 BLOCKED: ${pkg} is ${sizeMB}MB. Too heavy for mobile.`)
            setIsProcessing(false)
            return
          }
          if (sizeMB > 10) addBlock('', `⚠️ WARNING: ${pkg} is ${sizeMB}MB`, null)
          try {
            const proc = await wcRef.current.spawn('npm', ['install', args[1]], { cwd: fullPath })
            proc.output.pipeTo(new WritableStream({ write(data) { addBlock('', data, null) } }))
            const code = await proc.exit
            if (code === 0) {
              await syncToPhone(fullPath)
              addBlock('', `✅ ${pkg} installed`, null)
            }
          } catch (e) { addBlock('', null, `Install error: ${e.message}`) }
        }
        else if (args[0] === 'install' &&!args[1]) {
          addBlock(input, `Installing from package.json...`, null)
          try {
            const proc = await wcRef.current.spawn('npm', ['install'], { cwd: fullPath })
            proc.output.pipeTo(new WritableStream({ write(data) { addBlock('', data, null) } }))
            await proc.exit
            await syncToPhone(fullPath)
            addBlock('', `✅ Dependencies installed`, null)
          } catch (e) { addBlock('', null, `Install error: ${e.message}`) }
        }
        else if (args[0] === 'run') {
          if (!args[1]) { addBlock(input, null, 'Usage: npm run <script>'); setIsProcessing(false); return }
          addBlock(input, `Running script: ${args[1]}`, null)
          try {
            const proc = await wcRef.current.spawn('npm', ['run', args[1]], { cwd: fullPath })
            proc.output.pipeTo(new WritableStream({
              write(data) {
                addBlock('', data, null)
                if (data.includes('localhost:')) addBlock('', `🌐 Keep app open to preview`, null)
              }
            }))
            await proc.exit
          } catch (e) { addBlock('', null, `Run error: ${e.message}`) }
        }
        else if (args[0] === '--version') {
          try {
            const proc = await wcRef.current.spawn('npm', ['--version'], { cwd: fullPath })
            let output = ''
            proc.output.pipeTo(new WritableStream({ write(data) { output += data } }))
            await proc.exit
            addBlock('', `npm ${output.trim()}`, null)
          } catch (e) { addBlock('', null, `Version error: ${e.message}`) }
        }
        else {
          addBlock(input, null, `Unknown npm command. Type 'help'`)
        }
      }
      setIsProcessing(false)
      return
    }

    // NPX COMMANDS
    if (command === 'npx') {
      if (!args[0]) {
        addBlock(input, null, 'Usage: npx <package> [args]');
        setIsProcessing(false);
        return
      }

      if (isNative) {
        addBlock(input, `Running npx ${args[0]}...`, null)
        const result = await runBackendExec(input, getProjectName())
        if (result.stdout) addBlock('', result.stdout.trim(), null)
        if (result.stderr) addBlock('', null, result.stderr.trim())
        if (result.code === 0) addBlock('', `✅ npx completed`, null)
      } else {
        const pkg = args[0]
        addBlock(input, `Running npx ${pkg}...`, null)
        try {
          const proc = await wcRef.current.spawn('npx', args, { cwd: fullPath })
          proc.output.pipeTo(new WritableStream({ write(data) { addBlock('', data, null) } }))
          const code = await proc.exit
          if (code === 0) {
            await syncToPhone(fullPath)
            addBlock('', `✅ npx ${pkg} completed`, null)
          } else {
            addBlock('', null, `npx exited with code ${code}`)
          }
        } catch (e) {
          addBlock('', null, `npx error: ${e.message}`)
        }
      }
      setIsProcessing(false)
      return
    }

    // GIT COMMANDS
    if (command === 'git') {
      if (isNative) {
        addBlock(input, `Running: ${input}`, null)
        const result = await runBackendExec(input, getProjectName())
        if (result.stdout) addBlock('', result.stdout.trim(), null)
        if (result.stderr) addBlock('', null, result.stderr.trim())
        if (result.code === 0) addBlock('', '💾 Synced', null)
      } else {
        // Your existing isomorphic-git logic
        addBlock(input, `Running: ${input}`, null)
        try {
          await syncWCtoLFS(fullPath)
          if (args[0] === 'init') {
            await git.init({ fs, dir: fullPath })
            addBlock('', 'Initialized empty Git repository', null)
          }
          else if (args[0] === 'status') {
            const status = await git.statusMatrix({ fs, dir: fullPath })
            if (status.length === 0) {
              addBlock('', 'On branch main\nnothing to commit, working tree clean', null)
            } else {
              const lines = status.map(([filepath, head, workdir, stage]) => {
                if (head === 0 && workdir === 2 && stage === 0) return `?? ${filepath}`
                if (head === 1 && workdir === 2 && stage === 1) return ` M ${filepath}`
                if (head === 1 && workdir === 1 && stage === 2) return `A ${filepath}`
                if (head === 1 && workdir === 0 && stage === 1) return ` D ${filepath}`
                return filepath
              })
              addBlock('', `On branch main\n\n${lines.join('\n')}`, null)
            }
          }
          else if (args[0] === 'add') {
            if (args[1] === '.') {
              const status = await git.statusMatrix({ fs, dir: fullPath })
              for (const [filepath, head, workdir, stage] of status) {
                if (workdir!== head || workdir!== stage) await git.add({ fs, dir: fullPath, filepath })
              }
              addBlock('', `Added all changes`, null)
            } else if (args[1]) {
              await git.add({ fs, dir: fullPath, filepath: args[1] })
              addBlock('', `Added ${args[1]}`, null)
            }
          }
          else if (args[0] === 'commit') {
            const msgIndex = args.indexOf('-m')
            const message = msgIndex > -1? args[msgIndex + 1]?.replace(/['"]/g, '') : 'commit'
            const sha = await git.commit({ fs, dir: fullPath, message, author: { name: 'HYE User', email: 'user@hye.dev' } })
            addBlock('', `[main ${sha.slice(0,7)}] ${message}`, null)
          }
          else {
            addBlock('', null, `git: '${args[0]}' not supported yet on web`)
          }
          if (['init', 'add', 'commit'].includes(args[0])) {
            await syncToPhone(fullPath)
            addBlock('', `💾 Synced to phone`, null)
          }
        } catch (e) {
          addBlock('', null, `Git error: ${e.message}`)
        }
      }
      setIsProcessing(false)
      return
    }

    // UNIX COMMANDS
    if (['ls', 'cd', 'mkdir', 'cat', 'echo', 'touch', 'rm', 'pwd', 'clear'].includes(command)) {
      if (command === 'clear') { setBlocks([]); setIsProcessing(false); return }

      if (isNative) {
        if (command === 'cd') {
          const newPath = args[0]?.startsWith('/')? args[0] : `${cwd}/${args[0]}`
          setCwd(newPath.replace('//', '/'))
          addBlock(input, '', null)
        } else {
          const result = await runBackendExec(input, getProjectName())
          if (result.stdout) addBlock(input, result.stdout.trim(), null)
          else addBlock(input, '', result.stderr || null)
        }
      } else {
        try {
          const proc = await wcRef.current.spawn(command, args, { cwd: fullPath })
          let output = ''
          proc.output.pipeTo(new WritableStream({ write(data) { output += data } }))
          await proc.exit
          if (command === 'cd' && args[0]) {
            const newPath = args[0].startsWith('/')? args[0] : `${cwd}/${args[0]}`
            setCwd(newPath.replace('/home', '/HYE-Projects').replace('//', '/'))
          }
          if (['mkdir', 'touch', 'echo', 'rm'].includes(command)) await syncToPhone(fullPath)
          addBlock(input, output || 'Done', null)
        } catch (e) { addBlock(input, null, e.message) }
      }
      setIsProcessing(false)
      return
    }

    if (command === 'help') {
      addBlock(input, `HYE Terminal Commands:`, null)
      addBlock('', `hye create <react|vue|vanilla> [name] - Create project`, null)
      addBlock('', `npm install <pkg> / uninstall <pkg> / init / list / run <script>`, null)
      addBlock('', `npx <package> - Run package binaries`, null)
      addBlock('', `git init/add/commit/status/log/branch/checkout/reset/clone/push/pull`, null)
      addBlock('', `open - List projects | ls cd mkdir rm -rf cat - File ops`, null)
      setIsProcessing(false)
      return
    }

    addBlock(input, null, `Command not found: ${command}. Type 'help'`)
    setIsProcessing(false)
  }

  return (
    <div className="terminal" ref={terminalRef} data-theme={theme}>
      {notification && <div className={`terminal-notification ${notification.type}`}>{notification.text}</div>}
      {hint && wcBooted && <div className="terminal-hint">{hint}</div>}
      <div className="terminal-lines">
        {blocks.map(block => (
          <OutputLine key={block.id} cwd={block.cwd} command={block.command} output={block.output} error={block.error} />
        ))}
      </div>
      <Prompt
        ref={promptInputRef}
        cwd={cwd}
        onSubmit={handleCommand}
        history={history}
        historyIndex={historyIndex}
        setHistoryIndex={setHistoryIndex}
        disabled={isProcessing ||!wcBooted}
        theme={theme}
        value={currentInput}
        onChange={setCurrentInput}
      />
    </div>
  )
})

export default Terminal
