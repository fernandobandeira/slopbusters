import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const executableArgument = process.argv.find((argument) => argument.startsWith('--executable='))
const packagedExecutable = executableArgument?.slice('--executable='.length)
const electron = packagedExecutable || require('electron')
const dataDirectory = await mkdtemp(join(tmpdir(), 'slopbusters-desktop-smoke-'))
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE

async function run(phase) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(electron, [...(packagedExecutable ? [] : [directory]), '--smoke-test', `--smoke-user-data=${dataDirectory}`, `--smoke-phase=${phase}`], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let errors = ''
    child.stdout.on('data', (data) => { output = (output + data.toString()).slice(-16000) })
    child.stderr.on('data', (data) => { errors = (errors + data.toString()).slice(-16000) })
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Desktop ${phase} smoke timed out.\n${output}\n${errors}`)) }, 45000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0 || !output.includes(`"smoke":"${phase}"`)) {
        reject(new Error(`Desktop ${phase} smoke failed (${code}).\n${output}\n${errors}`))
      } else {
        console.log(output.trim())
        resolveRun()
      }
    })
  })
}

try {
  await run('write')
  await run('read')
  console.log('Desktop runtime, sandboxed renderer, local API, SQLite, and restart persistence verified.')
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}
