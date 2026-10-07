import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mock, test } from 'node:test'
import {
  findCheckpoint,
  prepareSubmission,
  readCheckpoint,
  releasePaths,
  restoreAndStaple,
  requireUnpublished,
  runTool,
  waitForAcceptance,
} from './notarization.mjs'

const id = '12345678-abcd-1234-abcd-123456789abc'
const result = (value) => ({ stdout: JSON.stringify(value), stderr: '' })

test('only a missing or draft release can proceed; permission and network errors stop it', async () => {
  const absent = async () => {
    throw new Error('gh: Not Found (HTTP 404)')
  }
  await requireUnpublished('example/project', 'reviewer-v0.1.17', absent)
  await requireUnpublished('example/project', 'reviewer-v0.1.17', async () =>
    result({ draft: true }),
  )
  await assert.rejects(
    requireUnpublished('example/project', 'reviewer-v0.1.17', async () => result({ draft: false })),
    /already published/,
  )
  await assert.rejects(
    requireUnpublished('example/project', 'reviewer-v0.1.17', async () => {
      throw new Error('HTTP 403')
    }),
    /HTTP 403/,
  )
})

test('command failures do not disclose passwords from argv, and hung tools are bounded', async () => {
  await assert.rejects(
    runTool(process.execPath, ['-e', 'process.exit(1)', 'fixture-password-argument']),
    (error) => {
      assert.ok(!error.message.includes('fixture-password-argument'))
      return true
    },
  )
  await assert.rejects(
    runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 30),
    /stopped or timed out/,
  )
})

test('saves the signed archive and submission identity before waiting, without credentials', async (t) => {
  const { context, run } = await fixture(t)
  const saved = await prepareSubmission(context, run)
  assert.equal(saved.submissionId, id)
  assert.equal((await readCheckpoint(context)).archiveSha256, saved.archiveSha256)
  const submit = run.mock.calls.find(({ arguments: [, args] }) => args.includes('submit'))
  assert.ok(submit.arguments[1].includes('--no-wait'))
  assert.ok(!submit.arguments[1].includes('--wait'))
  const contents = await readFile(releasePaths(context.directory).manifest, 'utf8')
  assert.ok(!contents.includes(context.credentials.password))
  assert.ok(!contents.includes(context.credentials.appleId))
  assert.equal(run.mock.calls.filter(({ arguments: [, args] }) => args.includes('info')).length, 0)
})

test('a slow submission resumes under the original ID without rebuilding or submitting again', async (t) => {
  const { context, run } = await fixture(t)
  await prepareSubmission(context, run)
  const clock = fakeClock()
  await assert.rejects(
    waitForAcceptance(context, { ...clock, run, waitMs: 60, pollMs: 30 }),
    /still processing.*Rerun/,
  )
  const resumed = mock.fn(async (_command, args) => {
    assert.equal(args[1], 'info')
    assert.equal(args[2], id)
    return result({ id, status: 'Accepted' })
  })
  const restored = { ...context, expected: { ...context.expected } }
  assert.equal(
    (await waitForAcceptance(restored, { ...fakeClock(), run: resumed })).submissionId,
    id,
  )
  assert.equal(
    run.mock.calls.filter(({ arguments: [, args] }) => args.includes('submit')).length,
    1,
  )
  assert.equal(resumed.mock.calls.length, 1)
})

test('temporary status failures recover, but repeated failures are bounded', async (t) => {
  const { context, run } = await fixture(t)
  await prepareSubmission(context, run)
  let attempts = 0
  const intermittent = async () => {
    if (++attempts === 1) throw new Error('Temporary network failure')
    return result({ id, status: 'Accepted' })
  }
  await waitForAcceptance(context, { ...fakeClock(), run: intermittent })
  assert.equal(attempts, 2)
  const unavailable = mock.fn(async () => {
    throw new Error('Apple unavailable')
  })
  await assert.rejects(
    waitForAcceptance(context, { ...fakeClock(), run: unavailable }),
    /failed repeatedly.*resume/,
  )
  assert.equal(unavailable.mock.calls.length, 5)
})

test('an Apple rejection stops immediately and saves its diagnostic log', async (t) => {
  const { context, run } = await fixture(t)
  await prepareSubmission(context, run)
  const rejected = mock.fn(async (_command, args) =>
    result(
      args[1] === 'info'
        ? { id, status: 'Invalid' }
        : {
            issues: [{ severity: 'error', message: 'Missing Hardened Runtime' }],
          },
    ),
  )
  await assert.rejects(
    waitForAcceptance(context, { ...fakeClock(), run: rejected }),
    /Apple rejected/,
  )
  assert.deepEqual(
    rejected.mock.calls.map(({ arguments: [, args] }) => args[1]),
    ['info', 'log'],
  )
  assert.match(
    await readFile(releasePaths(context.directory).diagnostics, 'utf8'),
    /Missing Hardened Runtime/,
  )
})

test('rejects a changed archive or a checkpoint from a different revision, version, or signing team', async (t) => {
  const { context, run } = await fixture(t)
  await prepareSubmission(context, run)
  for (const [key, value] of [
    ['commit', 'b'.repeat(40)],
    ['version', '0.1.18'],
    ['team', 'ZZZ123DEF4'],
  ])
    await assert.rejects(
      readCheckpoint({
        ...context,
        expected: { ...context.expected, [key]: value },
      }),
      /does not match/,
    )
  await writeFile(releasePaths(context.directory).archive, 'different signed bytes')
  await assert.rejects(readCheckpoint(context), /archive does not match/)
})

test('rejects malformed submissions and statuses without ever accepting them', async (t) => {
  const { context, run } = await fixture(t)
  await assert.rejects(
    prepareSubmission(context, async (command, args, timeout) =>
      args[1] === 'submit' ? result({ id: 'invalid' }) : run(command, args, timeout),
    ),
    /valid submission ID/,
  )
  await prepareSubmission(context, run)
  const incorrect = mock.fn(async () => result({ id: 'another-submission', status: 'Accepted' }))
  await assert.rejects(
    waitForAcceptance(context, { ...fakeClock(), run: incorrect }),
    /failed repeatedly/,
  )
  assert.equal(incorrect.mock.calls.length, 5)
})

test('restores the exact signed app and retries ticket propagation before validating the staple', async (t) => {
  const { context, run } = await fixture(t)
  await prepareSubmission(context, run)
  let staples = 0
  const finishing = mock.fn(async (command, args, timeout) => {
    if (args[0] === 'stapler' && args[1] === 'staple' && ++staples === 1)
      throw new Error('Ticket not yet available')
    return run(command, args, timeout)
  })
  await restoreAndStaple(context, { ...fakeClock(), run: finishing })
  assert.equal(staples, 2)
  const commands = finishing.mock.calls.map(
    ({ arguments: [command, args] }) => `${command} ${args.slice(0, 2).join(' ')}`,
  )
  assert.equal(commands[0], 'ditto -x -k')
  assert.equal(commands.at(-1), 'xcrun stapler validate')
  assert.ok(!commands.some((command) => command.includes('notarytool submit')))
})

test('a signature or bundle version mismatch blocks submission and packaging', async (t) => {
  const { context, run } = await fixture(t)
  const wrongTeam = async (command, args, timeout) =>
    command === 'codesign' && args[0] === '--display'
      ? {
          stdout: '',
          stderr: 'Authority=Developer ID Application: Example\nTeamIdentifier=WRONGTEAM0\n',
        }
      : run(command, args, timeout)
  await assert.rejects(prepareSubmission(context, wrongTeam), /signing team/)
  const wrongVersion = async (command, args, timeout) =>
    command.includes('PlistBuddy')
      ? { stdout: '0.1.16\n', stderr: '' }
      : run(command, args, timeout)
  await assert.rejects(prepareSubmission(context, wrongVersion), /app version/)
})

test('discovers retained release artifacts, ignoring expired, unrelated, and PR artifacts', async () => {
  const name = 'reviewer-notarization-reviewer-v0.1.17-' + 'a'.repeat(40)
  const calls = []
  const run = async (_command, args) => {
    calls.push(args[1])
    if (args[1].includes('/artifacts?'))
      return result({
        artifacts: [
          { name, expired: true, workflow_run: { id: 1 } },
          { name: 'other', expired: false, workflow_run: { id: 2 } },
          { name, expired: false, workflow_run: { id: 3 } },
          { name, expired: false, workflow_run: { id: 4 } },
          { name, expired: false, workflow_run: { id: 5 } },
        ],
      })
    return result(
      args[1].endsWith('/3')
        ? { path: 'unrelated.yml', event: 'push' }
        : {
            path: '.github/workflows/reviewer-release.yml',
            event: args[1].endsWith('/4') ? 'pull_request' : 'workflow_dispatch',
          },
    )
  }
  assert.equal(await findCheckpoint('example/project', name, run), 5)
  assert.equal(calls.length, 4)
})

function fakeClock() {
  let elapsed = 0
  return {
    now: () => elapsed,
    pause: async (ms) => {
      elapsed += ms
    },
    log: () => {},
  }
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'reviewer-notarization-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const context = {
    directory,
    expected: {
      tag: 'reviewer-v0.1.17',
      version: '0.1.17',
      commit: 'a'.repeat(40),
      team: 'ABC123DEF4',
    },
    credentials: {
      appleId: 'account@example.com',
      password: 'never-save-this-password',
    },
  }
  const run = mock.fn(async (command, args) => {
    if (command === 'ditto' && args[0] === '-c') await writeFile(args.at(-1), 'signed app archive')
    if (command === 'codesign')
      return {
        stdout: '',
        stderr: 'Authority=Developer ID Application: Example\nTeamIdentifier=ABC123DEF4\n',
      }
    if (command.includes('PlistBuddy')) return { stdout: '0.1.17\n', stderr: '' }
    if (args[0] === 'notarytool') return result({ id, status: 'In Progress' })
    return { stdout: '', stderr: '' }
  })
  return { context, run }
}
