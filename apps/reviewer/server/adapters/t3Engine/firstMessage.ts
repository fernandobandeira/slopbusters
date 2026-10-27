import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from '@t3tools/contracts'
import { T3_ENGINE_TURN_INPUT_MARGIN_CHARS } from '../../limits'
import type { z } from 'zod'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import {
  instructionsInFile,
  OVERFLOW_DIRECTORY,
  withOutputContract,
  wrapLongLines,
  type CopyAccess,
  type FileListing,
  type InspectionFiles,
} from './structuredOutput'

/** What the first message is made from: the turn's prompt, reply schema, agent and access. */
interface TurnInstructions {
  readonly model: OrganizationPreferences
  readonly prompt: string
  readonly schema: z.ZodType
  readonly copy?: CopyAccess
}

/**
 * The first message: the prompt and its output contract. The engine refuses a turn input over
 * `PROVIDER_SEND_TURN_MAX_INPUT_CHARS`, so what does not fit moves into files in the working
 * directory, first Claude's file list and then the prompt itself.
 */
export async function firstMessage(
  request: TurnInstructions,
  workspace: { readonly root: string; readonly files?: InspectionFiles },
): Promise<string> {
  const agent = request.model.provider
  const fits = (message: string) =>
    message.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS - T3_ENGINE_TURN_INPUT_MARGIN_CHARS
  const contract = (prompt: string, files: FileListing | undefined) =>
    withOutputContract(prompt, request.schema, agent, { files, access: request.copy })
  const inline = contract(request.prompt, workspace.files)
  if (fits(inline)) return inline
  const overflow = join(workspace.root, OVERFLOW_DIRECTORY)
  await mkdir(overflow, { recursive: true })
  let files: FileListing | undefined = workspace.files
  if (workspace.files) {
    const path = `${OVERFLOW_DIRECTORY}/files.txt`
    await writeFile(join(workspace.root, path), `${workspace.files.paths.join('\n')}\n`)
    files = { path, count: workspace.files.paths.length }
    const listed = contract(request.prompt, files)
    if (fits(listed)) return listed
  }
  const path = `${OVERFLOW_DIRECTORY}/instructions.md`
  const instructions = wrapLongLines(request.prompt)
  await writeFile(join(workspace.root, path), instructions)
  return contract(instructionsInFile(path, instructions, agent), files)
}
