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

  // Detect if we should use backend
  const shouldUseBackend = () => {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    const hasWebContainer = typeof SharedArrayBuffer !== 'undefined'
    return isMobile || !hasWebContainer
  }

  // Check if Capacitor is available
  const isCapacitorAvailable = () => {
    return typeof window !== 'undefined' && 
           window.Capacitor && 
           window.Capacitor.isNativePlatform?.()
  }

  // Prewarm Render backend
  const prewarmBackend = async () => {
    try {
      addBlock('system', 'Waking up backend...', null)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      await fetch(`${HYE_API}/`, {
        method: 'GET',
        signal: controller.signal
      }).catch(() => {})

      clearTimeout(timeout)
      addBlock('', ' Backend ready', null)
    } catch (e) {
      addBlock('', '⚠️ Backend may be slow. First command might take 30s.', null)
    }
  }

  // Backend exec for Android (kept for backward compatibility, but will be replaced)
  const runBackendExec = async (cmd, projectName = '') => {
    try {
      const res = await fetch(`${HYE_API}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd,
          projectName,
          cwd: cwd.replace('/HYE-Projects', '').replace(/^\/+/, '')
        })
      })
      return await res.json()
    } catch (e) {
      return { stdout: '', stderr: `Backend error: ${e.message}. Is Render deployed?`, code: 1 }
    }
  }

  const getProjectName = () => {
    if (cwd === '/HYE-Projects') return ''
    return cwd.split('/').pop()
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
        addBlock('', `📁 Importing ${folderName} (${files.length} files)...`, null)
        
        let successCount = 0
        let failCount = 0
        
        for (const file of files) {
          try {
            const content = await file.text()
            const relativePath = file.webkitRelativePath.replace(`${folderName}/`, '')
            
            if (isCapacitorAvailable()) {
              await Filesystem.writeFile({
                path: `HYE-Projects/${folderName}/${relativePath}`,
                data: content,
                directory: Directory.ExternalStorage,
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
        
        addBlock('', ` Saved ${successCount} files${failCount > 0 ? `, ${failCount} failed` : ''}`, null)
        addBlock('', `📁 Location: /HYE-Projects/${folderName}/`, null)
        
        if (!isCapacitorAvailable()) {
          addBlock('', `⚠️ Running in browser - files in memory only`, null)
        }
        
        resolve(folderName)
      }
      
      input.oncancel = () => reject(new Error('canceled'))
      input.click()
    })
  }

  // ============ FILE PICKER ============
  const handleOpenPicker = async () => {
    addBlock('hye import', '📂 Opening folder picker...', null)
    
    try {
      if (isCapacitorAvailable()) {
        try {
          const result = await useWebDirectoryPicker()
          if (result) {
            addBlock('', ` Imported to /HYE-Projects/${result}/`, null)
            setCwd(`/HYE-Projects/${result}`)
            return
          }
        } catch (e) {
          console.log('Picker failed:', e)
          addBlock('', '⚠️ Using web picker instead', null)
        }
      }
      
      const result = await useWebDirectoryPicker()
      if (result) {
        addBlock('', ` Imported to /HYE-Projects/${result}/`, null)
        setCwd(`/HYE-Projects/${result}`)
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
        setNotification({ type: 'booting', text: '🟡 Waking backend...' })
        prewarmBackend()

        try {
          await Filesystem.mkdir({ path: 'HYE-Projects', directory: Directory.ExternalStorage, recursive: true })
        } catch (e) { console.log('FS setup:', e) }

        setNotification({ type: 'success', text: '🟢 Terminal ready - Backend mode' })
        setTimeout(() => setNotification(null), 3000)
        setHint('💡 Type "npm --version" to test')
        setTimeout(() => setHint(null), 8000)
        setWcBooted(true)
        return
      }

      setNotification({ type: 'booting', text: 'Booting HYE Terminal...' })
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

  // ============ SCROLL ============
  const scrollToBottom = () => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' })
  }
  useEffect(scrollToBottom, [blocks])

  // ============ EXPOSE METHODS TO PARENT ============
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

  // ============ ADD BLOCK ============
  const addBlock = (command, output, error = null) => {
    setBlocks(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, cwd, command, output, error }])
  }

  // ============ GET PACKAGE SIZE ============
  const getPackageSize = async (pkg) => {
    try {
      const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`)
      const data = await res.json()
      return Math.round((data.dist?.unpackedSize || 0) / 1024 / 1024)
    } catch { return 0 }
  }

  // ============ SYNC FUNCTIONS ============
  const syncToPhone = async (projectPath) => {
    if (!shouldUseBackend()) return
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

  // ============ CAPACITOR-BASED LS ============
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

  // ============ SYNC TO BACKEND ============
  const syncProjectToBackend = async (projectName) => {
    addBlock('', '📤 Syncing files to backend...', null)
    try {
      const files = await readAllFilesFromCapacitor(`HYE-Projects/${projectName}`)
      const res = await fetch(`${HYE_API}/sync-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, files })
      })
      if (!res.ok) throw new Error('Sync failed')
      addBlock('', '✅ Synced to backend', null)
      return true
    } catch (e) {
      addBlock('', null, `Sync error: ${e.message}`)
      return false
    }
  }

  const readAllFilesFromCapacitor = async (basePath) => {
    const result = {}
    const entries = await Filesystem.readdir({
      path: basePath,
      directory: Directory.ExternalStorage
    })
    for (const entry of entries.files) {
      if (entry.type === 'directory') {
        const sub = await readAllFilesFromCapacitor(`${basePath}/${entry.name}`)
        Object.assign(result, sub)
      } else {
        const content = await Filesystem.readFile({
          path: `${basePath}/${entry.name}`,
          directory: Directory.ExternalStorage
        })
        result[`${basePath}/${entry.name}`] = typeof content.data === 'string' ? content.data : content.data
      }
    }
    return result
  }

  // ============ HANDLE COMMAND ============
  const handleCommand = async (input) => {
    if (!input.trim() || !wcBooted) return
    setHint(null)
    setIsProcessing(true)
    setCurrentInput('')
    const newHistory = [...history, input]
    setHistory(newHistory)
    setHistoryIndex(-1)

    const [command, ...args] = input.trim().split(/\s+/)
    const fullPath = cwd === '/HYE-Projects' ? '/home' : `/home${cwd.replace('/HYE-Projects', '')}`
    const useBackend = shouldUseBackend()

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
        addBlock('', `⚠️ Project name sanitized to: ${safeName}`, null)
      }

      // Check if project already exists
      let exists = false
      if (isCapacitorAvailable()) {
        try {
          await Filesystem.readdir({
            path: `HYE-Projects/${safeName}`,
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
        addBlock('', `⚠️ Project "${safeName}" already exists. Removing old version...`, null)
        if (isCapacitorAvailable()) {
          try {
            await Filesystem.rmdir({
              path: `HYE-Projects/${safeName}`,
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
        addBlock('', `🗑️ Old project removed.`, null)
      }

      addBlock(input, `📦 Creating ${template} project...`, null)

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
          addBlock('', null, `No files received from backend.`)
          setIsProcessing(false)
          return
        }

        addBlock('', `📥 Received ${Object.keys(files).length} files...`, null)

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
                  path: `HYE-Projects/${safeName}/${dirPath}`,
                  directory: Directory.ExternalStorage,
                  recursive: true
                })
              }
              await Filesystem.writeFile({
                path: `HYE-Projects/${safeName}/${filePath}`,
                data: content,
                directory: Directory.ExternalStorage,
                recursive: true
              })
            }
            savedCount++
          } catch (err) {
            console.log('Failed to save:', filePath, err)
          }
        }

        addBlock('', `✅ Created ${savedCount} files`, null)
        addBlock('', `📁 /HYE-Projects/${safeName}/`, null)
        addBlock('', `💾 Saved to your phone storage!`, null)
        addBlock('', `📝 Next: cd ${safeName} && npm install`, null)

        setCwd(`/HYE-Projects/${safeName}`)

        // Auto-sync to backend so npm commands work
        if (useBackend) {
          await syncProjectToBackend(safeName)
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
      const projectName = getProjectName()
      if (!projectName) {
        addBlock(input, null, 'No project selected. cd into a project first.')
        setIsProcessing(false)
        return
      }
      await syncProjectToBackend(projectName)
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
      if (useBackend) {
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

    // ============ PATH ============
if (command === 'path') {
      try {
        const relativePath = cwd.replace('/HYE-Projects', '')
        const uriResult = await Filesystem.getUri({
          path: relativePath || '',
          directory: Directory.ExternalStorage
        })
        const uriString = uriResult.uri || uriResult.toString()
        addBlock(input, `📂 Content URI: ${uriString}`, null)
        const fsPath = `/storage/emulated/0/Android/data/${window?.Capacitor?.getAppId?.() || 'com.hye.terminal'}/files/HYE-Projects${relativePath ? '/' + relativePath : ''}`
        addBlock('', `📁 Likely filesystem path: ${fsPath}`, null)
        addBlock('', `💡 Use a file manager that supports content URIs (e.g., CX File Explorer).`, null)
      } catch (e) {
        addBlock(input, null, `Error: ${e.message}`)
      }
      setIsProcessing(false)
      return
    }

    // ============ CD ============
    if (command === 'cd') {
      if (useBackend) {
        const newPath = args[0]?.startsWith('/') ? args[0] : `${cwd}/${args[0]}`
        setCwd(newPath.replace('//', '/'))
        addBlock(input, '', null)
      } else {
        try {
          const proc = await wcRef.current.spawn('cd', args, { cwd: fullPath })
          let output = ''
          proc.output.pipeTo(new WritableStream({ write(data) { output += data } }))
          await proc.exit
          if (args[0]) {
            const newPath = args[0].startsWith('/') ? args[0] : `${cwd}/${args[0]}`
            setCwd(newPath.replace('/home', '/HYE-Projects').replace('//', '/'))
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
          const relativePath = cwd.replace('/HYE-Projects', '')
          const files = await capacitorLs(relativePath)
          if (files && files.length > 0) {
            const names = files.map(f => f.name).join('  ')
            addBlock(input, `📁 ${names}`, null)
          } else {
            addBlock(input, '📁 (empty directory)', null)
          }
        } catch (e) {
          addBlock(input, null, `Error: ${e.message}`)
        }
      } else if (useBackend) {
        const result = await runBackendExec(input, getProjectName())
        if (result.stdout) addBlock(input, result.stdout.trim(), null)
        else addBlock(input, '', result.stderr || null)
      } else {
        try {
          const proc = await wcRef.current.spawn('ls', args, { cwd: fullPath })
          let output = ''
          proc.output.pipeTo(new WritableStream({ write(data) { output += data } }))
          await proc.exit
          addBlock(input, output || 'Done', null)
        } catch (e) { addBlock(input, null, e.message) }
      }
      setIsProcessing(false)
      return
    }

    // ============ NPM COMMANDS (fixed) ============
    if (command === 'npm') {
      if (useBackend) {
        const projectName = getProjectName()
        if (projectName && !input.includes('--version')) {
          await syncProjectToBackend(projectName)
        }
        addBlock(input, `Running: ${input}`, null)
        try {
          const res = await fetch(`${HYE_API}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cmd: input,
              projectName: projectName,
              cwd: ''
            })
          })
          const result = await res.json()
          if (result.stdout) addBlock('', result.stdout.trim(), null)
          if (result.stderr) addBlock('', null, result.stderr.trim())
          if (result.code === 0) addBlock('', '✅ Done', null)
        } catch (e) {
          addBlock('', null, `Exec error: ${e.message}`)
        }
      } else {
        // WebContainer npm commands
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
        else if (args[0] === 'install' && !args[1]) {
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
        // ============ NPX COMMANDS (fixed) ============
    if (command === 'npx') {
      if (!args[0]) {
        addBlock(input, null, 'Usage: npx <package>');
        setIsProcessing(false);
        return
      }

      if (useBackend) {
        const projectName = getProjectName()
        if (projectName) await syncProjectToBackend(projectName)
        addBlock(input, `Running npx ${args[0]}...`, null)
        try {
          const res = await fetch(`${HYE_API}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cmd: input,
              projectName: projectName,
              cwd: ''
            })
          })
          const result = await res.json()
          if (result.stdout) addBlock('', result.stdout.trim(), null)
          if (result.stderr) addBlock('', null, result.stderr.trim())
          if (result.code === 0) addBlock('', `✅ npx completed`, null)
        } catch (e) {
          addBlock('', null, `Exec error: ${e.message}`)
        }
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

    // ============ GIT COMMANDS (fixed) ============
    if (command === 'git') {
      if (useBackend) {
        const projectName = getProjectName()
        if (projectName) await syncProjectToBackend(projectName)
        addBlock(input, `Running: ${input}`, null)
        try {
          const res = await fetch(`${HYE_API}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cmd: input,
              projectName: projectName,
              cwd: ''
            })
          })
          const result = await res.json()
          if (result.stdout) addBlock('', result.stdout.trim(), null)
          if (result.stderr) addBlock('', null, result.stderr.trim())
          if (result.code === 0) addBlock('', '💾 Synced', null)
        } catch (e) {
          addBlock('', null, `Exec error: ${e.message}`)
        }
      } else {
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
              addBlock('', `Added all changes`, null)
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
            addBlock('', `💾 Synced to phone`, null)
          }
        } catch (e) {
          addBlock('', null, `Git error: ${e.message}`)
        }
      }
      setIsProcessing(false)
      return
    }

    // ============ UNIX COMMANDS ============
    if (['mkdir', 'cat', 'echo', 'touch', 'rm', 'pwd', 'clear'].includes(command)) {
      if (command === 'clear') { setBlocks([]); setIsProcessing(false); return }

      if (useBackend) {
        if (command === 'pwd') {
          addBlock(input, cwd, null)
        } else {
          // Use direct fetch for other commands with proper projectName
          const projectName = getProjectName()
          try {
            const res = await fetch(`${HYE_API}/exec`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cmd: input,
                projectName: projectName,
                cwd: ''
              })
            })
            const result = await res.json()
            if (result.stdout) addBlock(input, result.stdout.trim(), null)
            else addBlock(input, '', result.stderr || null)
          } catch (e) {
            addBlock(input, null, e.message)
          }
        }
      } else {
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
      addBlock(input, `HYE Terminal Commands:`, null)
      addBlock('', `hye create <react|vue|vanilla> [name] - Create project`, null)
      addBlock('', `hye sync - Sync current project to backend`, null)
      addBlock('', `hye import - Import folder from phone`, null)
      addBlock('', `npm install <pkg> / run <script> - Run npm commands (auto-sync)`, null)
      addBlock('', `npx <package> - Run package binaries`, null)
      addBlock('', `git init/add/commit/status/log/branch/checkout/reset/clone/push/pull`, null)
      addBlock('', `open - List projects | ls cd mkdir rm -rf cat - File ops`, null)
      addBlock('', `path - Show Android content URI for current folder`, null)
      setIsProcessing(false)
      return
    }

    // ============ UNKNOWN ============
    addBlock(input, null, `Command not found: ${command}. Type 'help'`)
    setIsProcessing(false)
  }  // <-- END of handleCommand

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
    </div>
  )
})

export default Terminal
