import { useEffect } from 'react'

function HelpModal({ show, onClose, theme }) {
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose()
    }
    if (show) document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [show, onClose])

  if (!show) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="help-modal" data-theme={theme} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>HYE TERMINAL - Full Guide</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-content">

          <div className="help-section">
            <h3>What is HYE Terminal?</h3>
            <p className="section-desc">
              A local Android shell inside the Capacitor app. Commands execute on-device in a persistent private home directory. No remote execution backend is used. Android does not include developer runtimes such as Git, Node.js, npm or Python by default; these require a compatible local runtime to be installed/bundled.
            </p>
          </div>

          <div className="help-section">
            <h3>Local Shell Commands</h3>
            <p className="section-desc">Run ordinary shell commands directly. Availability depends on the Android environment.</p>
            <div className="command-list">
              <div className="template-item">
                <code>hye create react myapp</code>
                <span>→ Vite + React 18 + React DOM. Instant HMR. Ready for APK build.</span>
              </div>
              <div className="template-item">
                <code>hye create vue myapp</code>
                <span>→ Vue 3 + Vite. Composition API setup. Single file components.</span>
              </div>
              <div className="template-item">
                <code>hye create vanilla myapp</code>
                <span>→ Plain HTML/CSS/JS + Vite. No framework. Lightweight start.</span>
              </div>
              <div className="template-item">
                <code>hye create express myapp</code>
                <span>→ Node.js + Express API server. REST ready.</span>
              </div>
              <div className="template-item">
                <code>hye create nextjs myapp</code>
                <span>→ Next.js fullstack. App Router. ~8MB.</span>
              </div>
            </div>
          </div>

          <div className="help-section">
            <h3>What this build supports</h3>
            <div className="feature-list">
              <p><strong>1. Local execution:</strong> Uses Android’s own <code>/system/bin/sh</code>, not a remote server.</p>
              <p><strong>2. Persistent workspace:</strong> Files are stored in the app’s private home directory.</p>
              <p><strong>3. Process output:</strong> stdout and stderr stream into the terminal; Ctrl+C can stop the active process.</p>
              <p><strong>4. Command history:</strong> Use ↑↓ arrows to cycle through previous commands.</p>
              <p><strong>5. Runtime honesty:</strong> Git, Node.js, npm and a Linux package manager are not built into Android; commands need compatible local binaries.</p>
            </div>
          </div>

          <div className="help-section">
            <h3>NPM Commands</h3>
            <div className="command-list">
              <code>npm install &lt;pkg&gt;</code><span>Install package. Size check included</span>
              <code>npm install</code><span>Install all from package.json</span>
              <code>npm uninstall &lt;pkg&gt;</code><span>Remove package from project</span>
              <code>npm init -y</code><span>Create package.json fast</span>
              <code>npm list</code><span>Show installed packages</span>
              <code>npm run &lt;script&gt;</code><span>Run scripts: dev, build, test</span>
              <code>npm create &lt;template&gt;</code><span>Scaffold: vite, next-app, etc</span>
              <code>npm --version</code><span>Check npm version</span>
              <code>npx &lt;package&gt;</code><span>Run binaries: cowsay, prettier, tsc</span>
            </div>
          </div>

          <div className="help-section">
            <h3>Git Commands</h3>
            <p className="section-desc">These commands are passed to the local shell. They work only when a compatible local Git executable is present.</p>
            <div className="command-list">
              <code>git init</code><span>Initialize empty repository</span>
              <code>git status</code><span>Show changed files</span>
              <code>git add.</code><span>Stage all changes</span>
              <code>git commit -m "msg"</code><span>Commit staged changes</span>
              <code>git log</code><span>Show commit history</span>
              <code>git branch</code><span>List branches</span>
              <code>git checkout -b &lt;name&gt;</code><span>Create + switch branch</span>
              <code>git checkout &lt;name&gt;</code><span>Switch branch</span>
              <code>git reset --hard</code><span>Discard all changes</span>
              <code>git reset</code><span>Unstage changes</span>
              <code>git clone &lt;url&gt;</code><span>Clone repo from GitHub</span>
              <code>git push</code><span>Push to remote</span>
              <code>git pull</code><span>Pull from remote</span>
              <code>git remote add &lt;name&gt; &lt;url&gt;</code><span>Add remote</span>
              <code>git remote -v</code><span>List remotes</span>
            </div>
          </div>

          <div className="help-section">
            <h3>File Commands</h3>
            <div className="command-list">
              <code>ls</code><span>List files in current directory</span>
              <code>cd [folder]</code><span>Change directory</span>
              <code>cd..</code><span>Go back one folder</span>
              <code>pwd</code><span>Show current path</span>
              <code>cat [file]</code><span>Print file contents</span>
              <code>mkdir [name]</code><span>Create new folder</span>
              <code>touch [file]</code><span>Create empty file</span>
              <code>rm [file]</code><span>Delete file</span>
              <code>rm -rf [folder]</code><span>Delete folder recursively. No trash bin</span>
              <code>clear</code><span>Clear terminal screen</span>
              <code>open</code><span>List all projects in /home</span>
            </div>
          </div>

          <div className="help-section">
            <h3>Project Commands</h3>
            <div className="command-list">
              <code>hye create [template]</code><span>Create new project from template</span>
              <code>npm run dev</code><span>Start dev server. Keep app open to preview</span>
              <code>npm run build</code><span>Build for production</span>
              <code>history</code><span>Show all commands you ran</span>
            </div>
          </div>

          <div className="help-section">
            <h3>Keyboard Shortcuts</h3>
            <div className="shortcut-grid">
              <span>Esc</span><span>Clear current input</span>
              <span>Ctrl+C</span><span>Cancel command - shows ^C</span>
              <span>Ctrl+L</span><span>Clear terminal screen</span>
              <span>↑</span><span>Previous command</span>
              <span>↓</span><span>Next command</span>
              <span>Ctrl+A</span><span>Jump to start of line</span>
              <span>Ctrl+E</span><span>Jump to end of line</span>
              <span>Ctrl+U</span><span>Delete to start</span>
              <span>Ctrl+K</span><span>Delete to end</span>
              <span>Ctrl+W</span><span>Delete previous word</span>
            </div>
          </div>

          <div className="help-section">
            <h3>Current Limitations</h3>
            <div className="feature-list">
              <p><strong>1. No bundled Linux distribution yet:</strong> this bridge invokes Android’s system shell, not a complete Linux userspace.</p>
              <p><strong>2. Developer tools:</strong> Git, Node.js/npm, Python, compilers and package managers must be added as Android-compatible binaries before they can run.</p>
              <p><strong>3. Storage:</strong> this workspace is private to the app unless files are exported.</p>
            </div>
          </div>

          <div className="help-section">
            <h3>Workflow: From Zero to APK</h3>
            <div className="feature-list">
              <p><strong>1.</strong> <code>hye create react myapp</code></p>
              <p><strong>2.</strong> <code>npm install axios</code></p>
              <p><strong>3.</strong> <code>git init && git add. && git commit -m "start"</code></p>
              <p><strong>4.</strong> Files auto-save to <code>/HYE-Projects/myapp/</code></p>
              <p><strong>5.</strong> Open Code Editor APK → edit files</p>
              <p><strong>6.</strong> Build APK from your project</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

export default HelpModal