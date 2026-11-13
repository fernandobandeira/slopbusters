import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { logError } from '../errors'

/** Where evidence folders live, each named after the process that owns it. */
const EVIDENCE_ROOT = join(tmpdir(), 'slopbusters-evidence')

/** A temporary folder of evidence files that model passes copy into their working directories. */
export interface EvidenceFolder {
  readonly directory: string
  /** Delete the folder and its files; a failure only logs. */
  remove(): Promise<void>
}

/**
 * Write each file, by its plain name, into a new temporary folder. Nothing is left behind when a
 * write fails, and folders a process left when it stopped without removing them are removed first.
 */
export async function writeEvidenceFolder(
  files: readonly { name: string; text: string }[],
  root = EVIDENCE_ROOT,
): Promise<EvidenceFolder> {
  await removeAbandoned(root)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, `${String(process.pid)}-`))
  const remove = () => removeFolder(directory)
  try {
    await Promise.all(
      files.map(({ name, text }) => {
        if (basename(name) !== name || name.startsWith('.'))
          throw new Error(`An evidence file needs a plain name: ${name}`)
        return writeFile(join(directory, name), text)
      }),
    )
  } catch (error) {
    await remove()
    throw error
  }
  return { directory, remove }
}

/** Folders whose owning process is gone, as when the app crashed during a round. */
async function removeAbandoned(root: string) {
  const entries = await readdir(root).catch(() => [])
  for (const entry of entries) {
    const owner = Number(/^(\d+)-/.exec(entry)?.[1])
    if (owner && !running(owner)) await removeFolder(join(root, entry))
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function removeFolder(directory: string) {
  try {
    await rm(directory, { recursive: true, force: true })
  } catch (error) {
    logError('Removing an evidence folder', error)
  }
}
