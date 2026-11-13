import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { logError } from '../errors'

/** A temporary folder of evidence files that model passes copy into their working directories. */
export interface EvidenceFolder {
  readonly directory: string
  /** Delete the folder and its files; a failure only logs. */
  remove(): Promise<void>
}

/**
 * Write each file, by its plain name, into a new temporary folder. Nothing is left behind when a
 * write fails.
 */
export async function writeEvidenceFolder(
  files: readonly { name: string; text: string }[],
): Promise<EvidenceFolder> {
  const directory = await mkdtemp(join(tmpdir(), 'slopbusters-evidence-'))
  const remove = async () => {
    try {
      await rm(directory, { recursive: true, force: true })
    } catch (error) {
      logError('Removing an evidence folder', error)
    }
  }
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
