import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function loadReviewSkill(options: {
  staticDirectory: string
  filename: string
  skillDirectory?: string
  files: string[]
}): Promise<string> {
  if (!options.skillDirectory)
    return readFile(join(options.staticDirectory, options.filename), 'utf8')
  const directory = options.skillDirectory
  return (
    await Promise.all(options.files.map((file) => readFile(join(directory, file), 'utf8')))
  ).join('\n\n')
}
