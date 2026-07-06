import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { WebContainer } from '@webcontainer/api'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'

import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import FS from '@isomorphic-git/lightning-fs'
import OutputLine from './OutputLine'
import Prompt from './Prompt'

let webcontainerInstance = null
const fs = new FS('fs')
const HYE_API = 'https://hye-api.onrender.com'

// ---- Config helpers (stores in Directory.Data/.hyeconfig) ----
async function readConfig() {
  try {
    const result = await Filesystem.readFile({
      path: '.hyeconfig',
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })
    return JSON.parse(result.data)
  } catch {
    return {}
  }
}

async function writeConfig(config) {
  await Filesystem.writeFile({
    path: '.hyeconfig',
    data: JSON.stringify(config),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  })
}

async function getConfigKey(key) {
  const cfg = await readConfig()
  return cfg[key] || ''
}

async function setConfigKey(key, value) {
  const cfg = await readConfig()
  if (value === undefined || value === null || value === '') {
    delete cfg[key]
  } else {
    cfg[key] = value
  }
  await writeConfig(cfg)
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
  const wcRef = useRef(null)
  const hasBooted = useRef(false)
  const projectCache = useRef({})

  const shouldUseBackend = () => {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    const hasWebContainer = typeof SharedArrayBuffer !== 'undefined'
    return isMobile || !hasWebContainer
  }

  const isCapacitorAvailable = () => {
    return typeof window !== 'undefined' &&
           window.Capacitor &&
           window.Capacitor.isNativePlatform?.()
  }

  const prewarmBackend = async () => {
    try {
      addBlock('system', 'Waking up backend...', null)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      await fetch(`${HYE_API}/`, { method: 'GET', signal: controller.signal }).catch(() => {})
      clearTimeout(timeout)
      addBlock('', 'Backend ready', null)
    } catch (e) {
      addBlock('', 'Backend may be slow. First command might take 30s.', null)
    }
  }

  const runBackendExec = async (cmd, cwdPath = '') => {
    try {
      const [user_name, user_email] = await Promise.all([
        getConfigKey('user.name'),
        getConfigKey('user.email')
      ])
      const res = await fetch(`${HYE_API}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd,
          cwd: cwdPath || cwd.replace(/^\/+/, ''),
          user_id: user_email,
          user_name,
          user_email
        })
      })
      return await res.json()
    } catch (e) {
      return { stdout: '', stderr: `Backend error: ${e.message}. Is Render deployed?`, code: 1 }
    }
  }

  // ============ WEB DIRECTORY PICKER ============
  const useWebDirectoryPicker = () => {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.webkitdirectory = true
      input.multiple = true
      input.accept = '*/*'

      input.onchange = async (e) => {
        const files = e.target.files
        if (!files || files.length === 0) {
          reject(new Error('No files selected'))
          return
        }
        const folderName = files[0].webkitRelativePath.split('/')[0]
        addBlock('', `Importing ${folderName} (${files.length} files)...`, null)
        let successCount = 0, failCount = 0
        for (const file of files) {
          try {
            const content = await file.text()
            const relativePath = file.webkitRelativePath.replace(`${folderName}/`, '')
            if (isCapacitorAvailable()) {
              await Filesystem.writeFile({
                path: `${cwd}/${folderName}/${relativePath}`,
                data: content,
                directory: Directory.ExternalStorage,
                encoding: Encoding.UTF8,
                recursive: true
              })
              successCount++
            } else {
              if (!window._importedFiles) window._importedFiles = {}
              window._importedFiles[`${folderName}/${relativePath}`] = content
              successCount++
            }
          } catch (err) {
            failCount++
            console.log('Failed to save:', file.name, err)
          }
        }
        addBlock('', `Saved ${successCount} files${failCount > 0 ? `, ${failCount} failed` : ''}`, null)
        addBlock('', `Location: ${cwd}/${folderName}/`, null)
        if (!isCapacitorAvailable()) {
          addBlock('', 'Running in browser - files in memory only', null)
        }
        resolve(folderName)
      }
      input.oncancel = () => reject(new Error('canceled'))
      input.click()
    })
  }

  const handleOpenPicker = async () => {
    addBlock('hye import', 'Opening folder picker...', null)
    try {
      const result = await useWebDirectoryPicker()
      if (result) {
        setCwd(`${cwd}/${result}`)
        addBlock('', `Imported to ${cwd}/${result}/`, null)
      }
    } catch (e) {
      if (e.message === 'canceled') {
        addBlock('', 'Picker canceled', null)
      } else {
        addBlock('', null, `Picker error: ${e.message}`)
      }
    }
  }

  // ============ BOOT ============
  useEffect(() => {
    if (hasBooted.current) return
    hasBooted.current = true

    const boot = async () => {
      if (shouldUseBackend()) {
        setNotification({ type: 'booting', text: 'Waking backend...' })
        prewarmBackend()
        try {
          await Filesystem.mkdir({ path: '', directory: Directory.ExternalStorage, recursive: true })
        } catch (e) { console.log('FS setup:', e) }
        setNotification({ type: 'success', text: 'Terminal ready - Backend mode' })
        setTimeout(() => setNotification(null), 3000)
        setHint('Type "npm --version" to test')
        setTimeout(() => setHint(null), 8000)
        setWcBooted(true)

        // Check if Git identity is set
        const name = await getConfigKey('user.name')
        const email = await getConfigKey('user.email')
        if (!name || !email) {
          setShowSetup(true)
          setIsProcessing(true)
        }
        return
      }

      setNotification({ type: 'booting', text: 'Booting HYE Terminal...' })
      if (!webcontainerInstance) webcontainerInstance = await WebContainer.boot()
      wcRef.current = webcontainerInstance
      try { await wcRef.current.fs.readdir('/home') }
      catch { await wcRef.current.fs.mkdir('/home', { recursive: true }) }
      setNotification({ type: 'success', text: 'Terminal ready with git + npm + npx' })
      setTimeout(() => setNotification(null), 4000)
      setHint('Type "help" for commands')
      setTimeout(() => setHint(null), 10000)
      setWcBooted(true)
    }
    boot()
  }, [])

  // ============ SCROLL ============
  const scrollToBottom = () => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' })
  }
  useEffect(scrollToBottom, [blocks])

  useImperativeHandle(ref, () => ({
    runCommand: (cmd) => handleCommand(cmd),
    runEsc: () => { setCurrentInput(''); setHistoryIndex(-1); promptInputRef.current?.focus() },
    runTab: () => { /* tab completion placeholder */ },
    runCtrlC: () => { addBlock(currentInput, null, '^C'); setCurrentInput(''); setHistoryIndex(-1) },
    runCtrlL: () => setBlocks([]),
    runArrowUp: () => {
      if (history.length === 0) return
      const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex
      setHistoryIndex(newIndex)
      setCurrentInput(history[history.length - 1 - newIndex])
    },
    runArrowDown: () => {
      if (historyIndex <= 0) { setHistoryIndex(-1); setCurrentInput(''); return }
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setCurrentInput(history[history.length - 1 - newIndex])
    },
    runCtrlA: () => { /* go to start placeholder */ },
    runCtrlE: () => { /* go to end placeholder */ },
    runCtrlU: () => { /* clear line placeholder */ },
    runCtrlK: () => { /* clear after cursor placeholder */ },
    runCtrlW: () => { /* delete word placeholder */ },
    runCtrlR: () => { /* reverse search placeholder */ },
    openFilePicker: handleOpenPicker
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
    if (!shouldUseBackend()) return
    try {
      const files = await wcRef.current.fs.readdir(projectPath, { withFileTypes: true })
      for (const file of files) {
        const fullPath = `${projectPath}/${file.name}`
        if (file.isDirectory()) {
          try {
            await Filesystem.mkdir({
              path: `${cwd}/${fullPath.replace('/home/', '')}`,
              directory: Directory.ExternalStorage,
              recursive: true
            })
          } catch {}
          await syncToPhone(fullPath)
        } else {
          const content = await wcRef.current.fs.readFile(fullPath, 'utf-8')
          await Filesystem.writeFile({
            path: `${cwd}/${fullPath.replace('/home/', '')}`,
            data: content,
            directory: Directory.ExternalStorage,
            encoding: Encoding.UTF8,
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

  const capacitorLs = async (path) => {
    try {
      const result = await Filesystem.readdir({
        path: path || '',
        directory: Directory.ExternalStorage
      })
      return result.files
    } catch (e) {
      return null
    }
  }

  const readAllFilesFromWebContainer = async (basePath, relativePath = '') => {
    const result = {}
    try {
      const entries = await wcRef.current.fs.readdir(basePath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = `${basePath}/${entry.name}`
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          const sub = await readAllFilesFromWebContainer(fullPath, relPath)
          Object.assign(result, sub)
        } else {
          const content = await wcRef.current.fs.readFile(fullPath, 'utf-8')
          result[relPath] = content
        }
      }
    } catch (e) {
      console.log('Error reading WebContainer:', e)
    }
    return result
  }

  const readAllFilesFromCapacitor = async (basePath) => {
    const result = {}
    try {
      const entries = await Filesystem.readdir({
        path: basePath || '',
        directory: Directory.ExternalStorage
      })
      for (const entry of entries.files) {
        if (entry.type === 'directory') {
          const sub = await readAllFilesFromCapacitor(`${basePath}/${entry.name}`)
          Object.assign(result, sub)
        } else {
          const content = await Filesystem.readFile({
            path: `${basePath}/${entry.name}`,
            directory: Directory.ExternalStorage,
            encoding: Encoding.UTF8
          })
          const relPath = basePath ? `${basePath}/${entry.name}` : entry.name
          result[relPath] = typeof content.data === 'string' ? content.data : content.data
        }
      }
    } catch (e) {
      console.log('Error reading Capacitor:', e)
    }
    return result
  }

  // ============ SYNC TO BACKEND (USES cwd + user_id) ============
  const syncProjectToBackend = async () => {
    if (!cwd) {
      addBlock('', null, 'No current directory.')
      return false
    }
    addBlock('', 'Syncing files to backend...', null)
    try {
      const files = await readAllFilesFromCapacitor(cwd)
      if (Object.keys(files).length === 0) {
        addBlock('', null, 'No files found to sync')
        return false
      }
      const user_email = await getConfigKey('user.email')
      const res = await fetch(`${HYE_API}/sync-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cwd: cwd.replace(/^\/+/, ''),
          files,
          user_id: user_email
        })
      })
      if (!res.ok) throw new Error('Sync failed')
      addBlock('', 'Synced to backend', null)
      return true
    } catch (e) {
      addBlock('', null, `Sync error: ${e.message}`)
      return false
    }
  }

  // ============ HANDLE COMMAND ============
  const handleCommand = async (input) => {
    if (!input.trim() || !wcBooted || isProcessing) return
    setHint(null)
    setIsProcessing(true)
    setCurrentInput('')
    const newHistory = [...history, input]
    setHistory(newHistory)
    setHistoryIndex(-1)

    const [command, ...args] = input.trim().split(/\s+/)
    const useBackend = shouldUseBackend()

    // ============ HYE CONFIG ============
    if (command === 'hye' && args[0] === 'config') {
      const subCmd = args[1]
      if (!subCmd || subCmd === '--list') {
        const name = await getConfigKey('user.name')
        const email = await getConfigKey('user.email')
        addBlock(input, `user.name: ${name || '(not set)'}`, null)
        addBlock('', `user.email: ${email || '(not set)'}`, null)
        if (!subCmd) {
          addBlock('', '', null)
          addBlock('', 'Usage:', null)
          addBlock('', '  hye config user.name "Your Name"', null)
          addBlock('', '  hye config user.email "you@example.com"', null)
          addBlock('', '  hye config --list     (show current)', null)
          addBlock('', '  hye config --reset    (clear both)', null)
        }
        setIsProcessing(false)
        return
      }

      if (subCmd === '--reset') {
        await setConfigKey('user.name', '')
        await setConfigKey('user.email', '')
        addBlock(input, 'Config cleared. Restart terminal to set new identity.', null)
        setShowSetup(true)
        setIsProcessing(true)
        setIsProcessing(false)
        return
      }

      if (subCmd === 'user.name') {
        const value = args.slice(2).join(' ')
        if (!value) {
          addBlock(input, null, 'Error: Name required. Usage: hye config user.name "John Doe"')
        } else {
          await setConfigKey('user.name', value)
          addBlock(input, `user.name set to: ${value}`, null)
        }
        setIsProcessing(false)
        return
      }

      if (subCmd === 'user.email') {
        const value = args.slice(2).join(' ')
        if (!value || !value.includes('@')) {
          addBlock(input, null, 'Error: Valid email required. Usage: hye config user.email "john@example.com"')
        } else {
          await setConfigKey('user.email', value)
          addBlock(input, `user.email set to: ${value}`, null)
        }
        setIsProcessing(false)
        return
      }

      addBlock(input, null, `Unknown config option: ${subCmd}`)
      setIsProcessing(false)
      return
    }

    // ============ HYE CREATE ============
    if (command === 'hye' && args[0] === 'create') {
      const template = args[1]
      const projectName = args[2] || `my-${template}-app`
      const TEMPLATES = { 'react': '2KB', 'vue': '2KB', 'vanilla': '1KB', 'express': '1KB' }

      if (!TEMPLATES[template]) {
        addBlock(input, null, `Template not found. Available: react, vue, vanilla, express`)
        setIsProcessing(false)
        return
      }

      const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '')
      if (safeName !== projectName) {
        addBlock('', `Project name sanitized to: ${safeName}`, null)
      }

      let exists = false
      if (isCapacitorAvailable()) {
        try {
          await Filesystem.readdir({
            path: `${cwd}/${safeName}`,
            directory: Directory.ExternalStorage
          })
          exists = true
        } catch (e) {}
      }
      if (wcRef.current) {
        try {
          await wcRef.current.fs.stat(`/home/${safeName}`)
          exists = true
        } catch (e) {}
      }

      if (exists) {
        addBlock('', `Project "${safeName}" already exists. Removing old version...`, null)
        if (isCapacitorAvailable()) {
          try {
            await Filesystem.rmdir({
              path: `${cwd}/${safeName}`,
              directory: Directory.ExternalStorage,
              recursive: true
            })
          } catch (e) {}
        }
        if (wcRef.current) {
          try {
            await wcRef.current.fs.rm(`/home/${safeName}`, { recursive: true, force: true })
          } catch (e) {}
        }
        addBlock('', 'Old project removed.', null)
        delete projectCache.current[safeName]
      }

      addBlock(input, `Creating ${template} project in ${cwd || '/'}...`, null)

      try {
        const response = await fetch(`${HYE_API}/hye-create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: template,
            name: safeName
          })
        })

        if (!response.ok) {
          let errorMsg = `HTTP ${response.status}`
          try {
            const errJson = await response.json()
            if (errJson.detail) errorMsg = errJson.detail
          } catch (e) {}
          addBlock('', null, `Backend error: ${errorMsg}`)
          setIsProcessing(false)
          return
        }

        const result = await response.json()
        if (!result.success) {
          addBlock('', null, `Backend error: ${result.detail || 'Unknown error'}`)
          setIsProcessing(false)
          return
        }

        const files = result.files
        if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
          addBlock('', null, 'No files received from backend.')
          setIsProcessing(false)
          return
        }

        addBlock('', `Received ${Object.keys(files).length} files...`, null)

        if (isCapacitorAvailable()) {
          try {
            await Filesystem.mkdir({
              path: `${cwd}/${safeName}`,
              directory: Directory.ExternalStorage,
              recursive: true
            })
          } catch (e) {
            console.log('Failed to create project dir:', e)
          }
        }

        projectCache.current[safeName] = files

        let savedCount = 0
        for (const [filePath, content] of Object.entries(files)) {
          if (!content && content !== '') continue
          try {
            if (wcRef.current) {
              const dirPath = filePath.split('/').slice(0, -1).join('/')
              if (dirPath) {
                await wcRef.current.fs.mkdir(`/home/${safeName}/${dirPath}`, { recursive: true })
              }
              await wcRef.current.fs.writeFile(`/home/${safeName}/${filePath}`, content)
            }

            if (isCapacitorAvailable()) {
              const dirPath = filePath.split('/').slice(0, -1).join('/')
              if (dirPath) {
                await Filesystem.mkdir({
                  path: `${cwd}/${safeName}/${dirPath}`,
                  directory: Directory.ExternalStorage,
                  recursive: true
                })
              }
              await Filesystem.writeFile({
                path: `${cwd}/${safeName}/${filePath}`,
                data: content,
                directory: Directory.ExternalStorage,
                encoding: Encoding.UTF8,
                recursive: true
              })
            }
            savedCount++
          } catch (err) {
            console.log('Failed to save:', filePath, err)
          }
        }

        addBlock('', `Created ${savedCount} files`, null)
        addBlock('', `${cwd}/${safeName}/`, null)
        addBlock('', 'Saved to your phone storage!', null)
        addBlock('', `Next: cd ${safeName} && npm install`, null)

        setCwd(`${cwd}/${safeName}`)

        if (useBackend) {
          await syncProjectToBackend()
        }

      } catch (e) {
        addBlock('', null, `Create error: ${e.message}`)
        console.error('hye create error:', e)
      }

      setIsProcessing(false)
      return
    }

    // ============ HYE SYNC ============
    if (command === 'hye' && args[0] === 'sync') {
      await syncProjectToBackend()
      setIsProcessing(false)
      return
    }

    // ============ HYE IMPORT ============
    if (command === 'hye' && args[0] === 'import') {
      await handleOpenPicker()
      setIsProcessing(false)
      return
    }

    // ============ OPEN ============
    if (command === 'open') {
      if (useBackend && isCapacitorAvailable()) {
        try {
          const result = await Filesystem.readdir({
            path: cwd || '',
            directory: Directory.ExternalStorage
          })
          addBlock(input, 'Contents:', null)
          result.files.forEach(f => addBlock('', ` ${f.type === 'directory' ? '📁' : '📄'} ${f.name}`, null))
        } catch {
          addBlock(input, null, 'Cannot read directory')
        }
      } else {
        try {
          const dir = await wcRef.current.fs.readdir('/home')
          addBlock(input, 'Contents:', null)
          dir.forEach(d => addBlock('', ` ${d}`, null))
        } catch {
          addBlock(input, null, 'No projects. Create one: hye create react myapp')
        }
      }
      setIsProcessing(false)
      return
    }

    // ============ PATH ============
    if (command === 'path') {
      try {
        const uriResult = await Filesystem.getUri({
          path: cwd || '',
          directory: Directory.ExternalStorage
        })
        const uriString = uriResult.uri || uriResult.toString()
        addBlock(input, `Content URI: ${uriString}`, null)
        const fsPath = `/storage/emulated/0/Android/data/${window?.Capacitor?.getAppId?.() || 'com.hye.terminal'}/files/${cwd || ''}`
        addBlock('', `Likely filesystem path: ${fsPath}`, null)
        addBlock('', 'Use a file manager that supports content URIs.', null)
      } catch (e) {
        addBlock(input, null, `Error: ${e.message}`)
      }
      setIsProcessing(false)
      return
    }

    // ============ CD ============
    if (command === 'cd') {
      if (useBackend && isCapacitorAvailable()) {
        let newPath = args[0]
        if (!newPath) {
          setCwd('')
          addBlock(input, '', null)
          setIsProcessing(false)
          return
        }
        if (newPath.startsWith('/')) {
          setCwd(newPath)
        } else {
          const base = cwd ? `${cwd}/` : ''
          setCwd(`${base}${newPath}`)
        }
        addBlock(input, '', null)
      } else {
        try {
          const proc = await wcRef.current.spawn('cd', args, { cwd: `/home${cwd}` })
          let output = ''
          proc.output.pipeTo(new WritableStream({ write(data) { output += data } }))
          await proc.exit
          if (args[0]) {
            const newPath = args[0].startsWith('/') ? args[0] : `${cwd}/${args[0]}`
            setCwd(newPath.replace('/home', ''))
          }
          addBlock(input, output || 'Done', null)
        } catch (e) { addBlock(input, null, e.message) }
      }
      setIsProcessing(false)
      return
    }

    // ============ LS ============
    if (command === 'ls') {
      if (useBackend && isCapacitorAvailable()) {
        try {
          const files = await capacitorLs(cwd)
          if (files && files.length > 0) {
            const names = files.map(f => f.name).join('  ')
            addBlock(input, `📁 ${names}`, null)
          } else {
            addBlock(input, '(empty directory)', null)
          }
        } catch (e) {
          addBlock(input, null, `Error: ${e.message}`)
        }
      } else if (useBackend) {
        const result = await runBackendExec(input)
        if (result.stdout) addBlock(input, result.stdout.trim(), null)
        else addBlock(input, '', result.stderr || null)
      } else {
        try {
          const proc = await wcRef.current.spawn('ls', args, { cwd: `/home/${cwd}` })
          let output = ''
          proc.output.pipeTo(new WritableStream({ write(data) { output += data } }))
          await proc.exit
          addBlock(input, output || 'Done', null)
        } catch (e) { addBlock(input, null, e.message) }
      }
      setIsProcessing(false)
      return
    }

    // ============ NPM ============
    if (command === 'npm') {
      if (useBackend) {
        // Auto-sync before npm commands (except --version)
        if (!input.includes('--version')) {
          await syncProjectToBackend()
        }
        addBlock(input, `Running: ${input}`, null)
        const result = await runBackendExec(input)
        if (result.stdout) addBlock('', result.stdout.trim(), null)
        if (result.stderr) addBlock('', null, result.stderr.trim())
        if (result.code === 0) {
          addBlock('', 'Done', null)
          // Suggest sync after install
          if (args[0] === 'install') {
            addBlock('', 'Dependencies installed on backend. To preview: npm run dev', null)
          }
        }
      } else {
        // WebContainer npm commands (browser fallback)
        const fullPath = `/home/${cwd}`
        if (args[0] === 'install' && args[1]) {
          const pkg = args[1]?.replace(/@.*/, '')
          const sizeMB = await getPackageSize(pkg)
          addBlock(input, `Checking ${pkg}... ${sizeMB}MB`, null)
          if (sizeMB > 500) {
            addBlock('', null, `BLOCKED: ${pkg} is ${sizeMB}MB. Too heavy for mobile.`)
            setIsProcessing(false)
            return
          }
          if (sizeMB > 10) addBlock('', `WARNING: ${pkg} is ${sizeMB}MB`, null)
          try {
            const proc = await wcRef.current.spawn('npm', ['install', args[1]], { cwd: fullPath })
            proc.output.pipeTo(new WritableStream({ write(data) { addBlock('', data, null) } }))
            const code = await proc.exit
            if (code === 0) {
              await syncToPhone(fullPath)
              addBlock('', `${pkg} installed`, null)
            }
          } catch (e) { addBlock('', null, `Install error: ${e.message}`) }
        }
        else if (args[0] === 'install' && !args[1]) {
          addBlock(input, 'Installing from package.json...', null)
          try {
            const proc = await wcRef.current.spawn('npm', ['install'], { cwd: fullPath })
            proc.output.pipeTo(new WritableStream({ write(data) { addBlock('', data, null) } }))
            await proc.exit
            await syncToPhone(fullPath)
            addBlock('', 'Dependencies installed', null)
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
                if (data.includes('localhost:')) addBlock('', 'Keep app open to preview', null)
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
          addBlock(input, null, 'Unknown npm command. Type "help"')
        }
      }
      setIsProcessing(false)
      return
            }
        // ============ NPX ============
    if (command === 'npx') {
      if (!args[0]) {
        addBlock(input, null, 'Usage: npx <package>')
        setIsProcessing(false)
        return
      }
      if (useBackend) {
        await syncProjectToBackend()
        addBlock(input, `Running npx ${args[0]}...`, null)
        const result = await runBackendExec(input)
        if (result.stdout) addBlock('', result.stdout.trim(), null)
        if (result.stderr) addBlock('', null, result.stderr.trim())
        if (result.code === 0) addBlock('', 'npx completed', null)
      } else {
        const fullPath = `/home/${cwd}`
        const pkg = args[0]
        addBlock(input, `Running npx ${pkg}...`, null)
        try {
          const proc = await wcRef.current.spawn('npx', args, { cwd: fullPath })
          proc.output.pipeTo(new WritableStream({ write(data) { addBlock('', data, null) } }))
          const code = await proc.exit
          if (code === 0) {
            await syncToPhone(fullPath)
            addBlock('', `npx ${pkg} completed`, null)
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

    // ============ GIT ============
    if (command === 'git') {
      if (useBackend) {
        await syncProjectToBackend()
        addBlock(input, `Running: ${input}`, null)
        const result = await runBackendExec(input)
        if (result.stdout) addBlock('', result.stdout.trim(), null)
        if (result.stderr) addBlock('', null, result.stderr.trim())
        if (result.code === 0) {
          addBlock('', 'Synced', null)
          // Remind about cleanup after push
          if (args[0] === 'push') {
            addBlock('', 'Tip: To free backend storage after push, run: hye clean-backend-modules (if you have the endpoint)', null)
          }
        }
      } else {
        const fullPath = `/home/${cwd}`
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
                if (workdir !== head || workdir !== stage) await git.add({ fs, dir: fullPath, filepath })
              }
              addBlock('', 'Added all changes', null)
            } else if (args[1]) {
              await git.add({ fs, dir: fullPath, filepath: args[1] })
              addBlock('', `Added ${args[1]}`, null)
            }
          }
          else if (args[0] === 'commit') {
            const msgIndex = args.indexOf('-m')
            const message = msgIndex > -1 ? args[msgIndex + 1]?.replace(/['"]/g, '') : 'commit'
            const sha = await git.commit({ fs, dir: fullPath, message, author: { name: 'HYE User', email: 'user@hye.dev' } })
            addBlock('', `[main ${sha.slice(0,7)}] ${message}`, null)
          }
          else {
            addBlock('', null, `git: '${args[0]}' not supported yet on web`)
          }
          if (['init', 'add', 'commit'].includes(args[0])) {
            await syncToPhone(fullPath)
            addBlock('', 'Synced to phone', null)
          }
        } catch (e) {
          addBlock('', null, `Git error: ${e.message}`)
        }
      }
      setIsProcessing(false)
      return
    }

    // ============ OTHER UNIX COMMANDS ============
    if (['mkdir', 'cat', 'echo', 'touch', 'rm', 'pwd', 'clear'].includes(command)) {
      if (command === 'clear') { setBlocks([]); setIsProcessing(false); return }
      if (useBackend) {
        if (command === 'pwd') {
          addBlock(input, cwd || '/', null)
        } else {
          const result = await runBackendExec(input)
          if (result.stdout) addBlock(input, result.stdout.trim(), null)
          else addBlock(input, '', result.stderr || null)
        }
      } else {
        const fullPath = `/home/${cwd}`
        try {
          const proc = await wcRef.current.spawn(command, args, { cwd: fullPath })
          let output = ''
          proc.output.pipeTo(new WritableStream({ write(data) { output += data } }))
          await proc.exit
          if (['mkdir', 'touch', 'echo', 'rm'].includes(command)) await syncToPhone(fullPath)
          addBlock(input, output || 'Done', null)
        } catch (e) { addBlock(input, null, e.message) }
      }
      setIsProcessing(false)
      return
    }

    // ============ HELP ============
    if (command === 'help') {
      addBlock(input, 'HYE Terminal Commands:', null)
      addBlock('', 'hye create <react|vue|vanilla> [name] - Create project', null)
      addBlock('', 'hye sync - Sync source code to backend', null)
      addBlock('', 'hye import - Import folder from phone into current folder', null)
      addBlock('', 'npm install <pkg> / run <script> - Run npm commands (auto-sync)', null)
      addBlock('', 'npx <package> - Run package binaries', null)
      addBlock('', 'git init/add/commit/status/push - Version control', null)
      addBlock('', 'open, ls, cd, mkdir, rm, pwd - File ops', null)
      addBlock('', 'hye config - Manage Git identity (user.name, user.email)', null)
      addBlock('', 'path - Show Android content URI for current folder', null)
      setIsProcessing(false)
      return
    }

    // ============ UNKNOWN ============
    addBlock(input, null, `Command not found: ${command}. Type 'help'`)
    setIsProcessing(false)
  }

  // ============ RENDER ============
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
        disabled={isProcessing || !wcBooted}
        theme={theme}
        value={currentInput}
        onChange={setCurrentInput}
      />

      {/* ----- SETUP MODAL ----- */}
      {showSetup && (
        <div className="setup-overlay" style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div className="setup-modal" style={{
            background: '#1e1e1e',
            padding: '24px',
            borderRadius: '8px',
            border: '1px solid #3c3c3c',
            maxWidth: '400px',
            width: '90%',
          }}>
            <h3 style={{ color: '#58a6ff', margin: '0 0 8px' }}>Setup Git Identity</h3>
            <p style={{ color: '#ccc', fontSize: '13px', margin: '0 0 16px' }}>
              Git requires a name and email to identify your commits.
              These will also be used to isolate your projects on the backend.
              You can change them later with:<br />
              <code style={{ color: '#4ec9b0' }}>hye config user.name "New Name"</code><br />
              <code style={{ color: '#4ec9b0' }}>hye config user.email "new@email.com"</code>
            </p>
            <input
              type="text"
              placeholder="Your Name"
              value={setupName}
              onChange={e => setSetupName(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                marginBottom: '12px',
                background: '#0a0a0a',
                border: '1px solid #3c3c3c',
                color: '#eee',
                borderRadius: '4px',
                boxSizing: 'border-box',
              }}
            />
            <input
              type="email"
              placeholder="Your Email"
              value={setupEmail}
              onChange={e => setSetupEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                marginBottom: '12px',
                background: '#0a0a0a',
                border: '1px solid #3c3c3c',
                color: '#eee',
                borderRadius: '4px',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={async () => {
                if (!setupName.trim() || !setupEmail.trim() || !setupEmail.includes('@')) {
                  alert('Both fields are required and email must be valid.');
                  return;
                }
                await setConfigKey('user.name', setupName.trim());
                await setConfigKey('user.email', setupEmail.trim());
                setShowSetup(false);
                setIsProcessing(false);
                addBlock('system', 'Identity saved. You can change it anytime with: hye config user.name "New Name"', null);
              }}
              style={{
                width: '100%',
                padding: '10px',
                background: '#58a6ff',
                border: 'none',
                borderRadius: '4px',
                color: '#000',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              Save & Continue
            </button>
          </div>
        </div>
      )}
    </div>
  )
})

export default Terminal
