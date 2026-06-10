export const HELP_SECTIONS = [
  {
    title: 'FILE SYSTEM',
    commands: [
      { cmd: 'ls [dir]', desc: 'List directory contents' },
      { cmd: 'cd <dir>', desc: 'Change directory' },
      { cmd: 'pwd', desc: 'Print working directory' },
      { cmd: 'cat <file>', desc: 'Display file contents' },
      { cmd: 'mkdir <dir>', desc: 'Create directory' },
      { cmd: 'rm <file>', desc: 'Remove file or directory' },
      { cmd: 'cp <src> <dest>', desc: 'Copy files' },
      { cmd: 'mv <src> <dest>', desc: 'Move/rename files' }
    ]
  },

  {
    title: 'GIT COMMANDS',
    commands: [
      { cmd: 'git status', desc: 'Show working tree status' },
      { cmd: 'git add <file>', desc: 'Add file to staging' },
      { cmd: 'git add .', desc: 'Stage all changes' },
      { cmd: 'git commit -m "msg"', desc: 'Commit staged changes' },
      { cmd: 'git push', desc: 'Push to remote repository' },
      { cmd: 'git pull', desc: 'Fetch and merge from remote' },
      { cmd: 'git log', desc: 'Show commit history' },
      { cmd: 'git branch', desc: 'List or manage branches' },
      { cmd: 'git checkout <branch>', desc: 'Switch branches' }
    ]
  },

  {
    title: 'PROJECT COMMANDS',
    commands: [
      { cmd: 'npm install', desc: 'Install dependencies' },
      { cmd: 'npm run build', desc: 'Build project' },
      { cmd: 'npm start', desc: 'Start development server' },
      { cmd: 'yarn install', desc: 'Install with yarn' },
      { cmd: 'pnpm install', desc: 'Install with pnpm' },
      { cmd: 'python <file>', desc: 'Run Python script' },
      { cmd: 'node <file>', desc: 'Run Node.js script' }
    ]
  },

  {
    title: 'HYE COMMANDS',
    commands: [
      { cmd: 'hye create <template>', desc: 'Create new project from template' },
      { cmd: 'help', desc: 'Show help menu' },
      { cmd: 'clear', desc: 'Clear terminal screen' },
      { cmd: 'history', desc: 'Show command history' }
    ]
  }
]