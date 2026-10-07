import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const submissionId = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const workflowPath = '.github/workflows/reviewer-release.yml'

export async function runTool(command, args, timeout = 120_000) {
  try {
    return await execute(command, args, {
      timeout,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    })
  } catch (error) {
    // execFile's message includes argv, which contains the app-specific password.
    let detail = String(error.stderr ?? '').slice(-2000)
    for (const key of [
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'GH_TOKEN',
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
    ])
      if (process.env[key]) detail = detail.split(process.env[key]).join('[redacted]')
    throw new Error(
      `${command} failed (${error.killed ? 'stopped or timed out' : (error.code ?? 'unknown')}). ${detail}`,
    )
  }
}

export function releasePaths(directory) {
  const checkpoint = join(directory, 'apps/desktop/release/notary-checkpoint')
  return {
    checkpoint,
    archive: join(checkpoint, 'signed-app.zip'),
    manifest: join(checkpoint, 'submission.json'),
    app: join(directory, 'apps/desktop/release/mac-arm64/Slopbusters.app'),
    diagnostics: join(directory, 'apps/desktop/release/notarization-log.json'),
  }
}

export async function requireUnpublished(repository, tag, run = runTool) {
  try {
    const release = JSON.parse(
      (await run('gh', ['api', `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`]))
        .stdout,
    )
    if (!release.draft)
      throw new Error('This version is already published. Release a new version instead.')
  } catch (error) {
    if (!error.message.includes('HTTP 404')) throw error
  }
}

export async function findCheckpoint(repository, name, run = runTool) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid release repository.')
  const { stdout } = await run('gh', [
    'api',
    `repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`,
  ])
  const { artifacts } = JSON.parse(stdout)
  for (const artifact of artifacts) {
    if (artifact.name !== name || artifact.expired) continue
    const runId = artifact.workflow_run?.id
    if (!Number.isSafeInteger(runId) || runId <= 0) continue
    const workflow = JSON.parse(
      (await run('gh', ['api', `repos/${repository}/actions/runs/${runId}`])).stdout,
    )
    if (workflow.path === workflowPath && ['push', 'workflow_dispatch'].includes(workflow.event))
      return runId
  }
}

export async function prepareSubmission(context, run = runTool) {
  const paths = releasePaths(context.directory)
  await verifyApp(context, run)
  await mkdir(paths.checkpoint, { recursive: true })
  await run(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', paths.app, paths.archive],
    300_000,
  )
  const archiveSha256 = await checksum(paths.archive)
  const reply = await notary(context, ['submit', paths.archive, '--no-wait'], run, 300_000)
  if (!submissionId.test(reply.id ?? ''))
    throw new Error('Apple did not return a valid submission ID.')
  const checkpoint = {
    format: 1,
    ...context.expected,
    archiveSha256,
    submissionId: reply.id.toLowerCase(),
  }
  await writeFile(paths.manifest, JSON.stringify(checkpoint, null, 2) + '\n')
  return checkpoint
}

export async function readCheckpoint(context) {
  const paths = releasePaths(context.directory)
  const text = await readFile(paths.manifest, 'utf8')
  if (text.length > 64 * 1024) throw new Error('The notarization checkpoint is too large.')
  const checkpoint = JSON.parse(text)
  if (checkpoint.format !== 1 || !submissionId.test(checkpoint.submissionId ?? ''))
    throw new Error('Invalid notarization checkpoint.')
  for (const [key, value] of Object.entries(context.expected))
    if (checkpoint[key] !== value)
      throw new Error(`Notarization checkpoint ${key} does not match this release.`)
  if (checkpoint.archiveSha256 !== (await checksum(paths.archive)))
    throw new Error('The signed app archive does not match its notarization checkpoint.')
  return checkpoint
}

export async function waitForAcceptance(context, options = {}) {
  const {
    run = runTool,
    now = Date.now,
    pause = sleep,
    log = console.log,
    waitMs = 60 * 60 * 1000,
    pollMs = 30_000,
    maxErrors = 5,
  } = options
  const checkpoint = await readCheckpoint(context)
  const started = now()
  let errors = 0
  while (now() - started < waitMs) {
    let result
    try {
      result = await notary(context, ['info', checkpoint.submissionId], run, 60_000)
      if (
        typeof result.id !== 'string' ||
        result.id.toLowerCase() !== checkpoint.submissionId.toLowerCase() ||
        typeof result.status !== 'string'
      )
        throw new Error('Apple returned an invalid notarization status.')
      errors = 0
    } catch (error) {
      errors++
      log(`Notarization status unavailable (${errors}/${maxErrors}): ${error.message}`)
      if (errors >= maxErrors)
        throw new Error(
          'Apple status checks failed repeatedly. Rerun this release to resume the saved submission.',
        )
      await pause(pollMs)
      continue
    }
    log(
      `Apple submission ${checkpoint.submissionId}: ${result.status} (${Math.floor((now() - started) / 1000)}s elapsed)`,
    )
    if (result.status === 'Accepted') return checkpoint
    if (result.status === 'Invalid' || result.status === 'Rejected') {
      await saveRejection(context, checkpoint.submissionId, run, log)
      throw new Error(
        `Apple rejected submission ${checkpoint.submissionId}. See notarization-log.json; fix the signing issue before releasing.`,
      )
    }
    if (result.status !== 'In Progress')
      throw new Error(`Unexpected Apple status: ${result.status}.`)
    await pause(pollMs)
  }
  throw new Error(
    `Apple is still processing submission ${checkpoint.submissionId}. Rerun this release to resume it; the signed app and submission ID are saved.`,
  )
}

export async function restoreAndStaple(context, options = {}) {
  const { run = runTool, pause = sleep, log = console.log } = options
  await readCheckpoint(context)
  const paths = releasePaths(context.directory)
  await rm(paths.app, { recursive: true, force: true })
  await mkdir(join(paths.app, '..'), { recursive: true })
  await run('ditto', ['-x', '-k', paths.archive, join(paths.app, '..')], 300_000)
  await verifyApp(context, run)
  for (let attempt = 1; ; attempt++) {
    try {
      await run('xcrun', ['stapler', 'staple', paths.app])
      await run('xcrun', ['stapler', 'validate', paths.app])
      return
    } catch (error) {
      if (attempt === 3) throw error
      log(`Stapling attempt ${attempt} failed; retrying the accepted ticket.`)
      await pause(15_000)
    }
  }
}

async function verifyApp(context, run) {
  const { app } = releasePaths(context.directory)
  await run('codesign', ['--verify', '--deep', '--strict', app])
  const identity = await run('codesign', ['--display', '--verbose=4', app])
  const details = identity.stdout + identity.stderr
  if (
    !details.includes('Authority=Developer ID Application:') ||
    !details.split('\n').includes(`TeamIdentifier=${context.expected.team}`)
  )
    throw new Error('The signed app does not match the release signing team.')
  const version = await run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    join(app, 'Contents/Info.plist'),
  ])
  if (version.stdout.trim() !== context.expected.version)
    throw new Error('The signed app version does not match this release.')
}

async function checksum(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function notary(context, args, run, timeout) {
  const { stdout } = await run(
    'xcrun',
    [
      'notarytool',
      ...args,
      '--apple-id',
      context.credentials.appleId,
      '--password',
      context.credentials.password,
      '--team-id',
      context.expected.team,
      '--output-format',
      'json',
      '--no-progress',
    ],
    timeout,
  )
  return JSON.parse(stdout)
}

async function saveRejection(context, id, run, log) {
  try {
    const details = await notary(context, ['log', id], run, 60_000)
    await writeFile(
      releasePaths(context.directory).diagnostics,
      JSON.stringify(details, null, 2) + '\n',
    )
    log(
      `Apple rejection details saved to notarization-log.json (${details.issues?.length ?? 0} issues).`,
    )
  } catch (error) {
    log(`Could not retrieve Apple's rejection log: ${error.message}`)
  }
}
