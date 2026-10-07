import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  findCheckpoint,
  prepareSubmission,
  waitForAcceptance,
  restoreAndStaple,
  requireUnpublished,
  runTool,
} from './notarization.mjs'

async function main() {
  const directory = process.cwd()
  const { version } = JSON.parse(
    await readFile(join(directory, 'apps/desktop/package.json'), 'utf8'),
  )
  const tag = process.env.REVIEWER_TAG
  if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `reviewer-v${version}`)
    throw new Error('Release tag must match the desktop version.')
  const commit = (await runTool('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const team = process.env.APPLE_TEAM_ID
  if (!/^[a-f\d]{40}$/.test(commit) || !/^[A-Z\d]{10}$/.test(team ?? ''))
    throw new Error('Invalid release revision or signing team.')
  const context = {
    directory,
    expected: { tag, version, commit, team },
    credentials: {
      appleId: process.env.APPLE_ID,
      password: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    },
  }
  if (process.argv[2] === 'find') {
    await requireUnpublished(process.env.GITHUB_REPOSITORY ?? '', tag)
    const name = `reviewer-notarization-${tag}-${commit}`
    const runId = await findCheckpoint(process.env.GITHUB_REPOSITORY ?? '', name)
    if (!process.env.GITHUB_OUTPUT) throw new Error('This command requires GitHub Actions outputs.')
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `artifact-name=${name}\nrun-id=${runId ?? ''}\nfound=${Boolean(runId)}\n`,
    )
    console.log(
      runId
        ? `Resuming notarization checkpoint from run ${runId}.`
        : 'No saved submission; preparing a new signed app.',
    )
    return
  }
  if (!context.credentials.appleId || !context.credentials.password)
    throw new Error('Apple notarization credentials are required.')
  if (process.argv[2] === 'submit') {
    const checkpoint = await prepareSubmission(context)
    console.log(
      `Submitted to Apple: ${checkpoint.submissionId}. Save this checkpoint before waiting.`,
    )
  } else if (process.argv[2] === 'finish') {
    await waitForAcceptance(context)
    await restoreAndStaple(context)
  } else throw new Error('Expected find, submit, or finish.')
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
