import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from '@t3tools/contracts'
import { T3_ENGINE_TURN_INPUT_MARGIN_CHARS } from './limits'
import type { z } from 'zod'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { Provider } from '../../../shared/domain/types'
import {
  instructionsInFiles,
  OVERFLOW_DIRECTORY,
  overflowFiles,
  withOutputContract,
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
  const fits = (message: string) => message.length <= FIRST_MESSAGE_MAX_CHARS
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
  const parts = overflowFiles(request.prompt, agent)
  await Promise.all(parts.map((part) => writeFile(join(workspace.root, part.path), part.text)))
  return contract(instructionsInFiles(parts, agent), files)
}

/** The longest first message the engine takes, with room for what it adds. */
const FIRST_MESSAGE_MAX_CHARS =
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS - T3_ENGINE_TURN_INPUT_MARGIN_CHARS

/**
 * How many more characters `prompt` can grow before its first message no longer fits and moves
 * to a file; negative when it already does not fit. Lets a caller inline optional evidence only
 * while the agent still gets the whole task in one message.
 */
export function firstMessageRoom(prompt: string, schema: z.ZodType, agent: Provider): number {
  return FIRST_MESSAGE_MAX_CHARS - withOutputContract(prompt, schema, agent).length
}
