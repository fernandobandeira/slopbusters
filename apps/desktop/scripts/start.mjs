import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
  env: environment, stdio: 'inherit',
})
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
