import { z } from 'zod'
import { MAX_STRUCTURED_ERROR_CHARS } from '../../limits'
import { Provider } from '../../../shared/domain/types'

export type StructuredReply<T> =
  { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

/**
 * How the agent can inspect the copy. Claude's shell runs outside any sandbox, so every command
 * it asks for is declined, and Claude Code 2.1 has no Glob or Grep tool: Claude gets the copy's
 * file list and reads files by path. Codex runs commands in a sandbox confined to the copy.
 */
const inspectionRules: Record<Provider, string> = {
  claude:
    '- Read files by path with the Read tool; any files in the working directory are listed below. Do not use Bash or any other shell tool: every shell command is declined here.',
  codex:
    '- Inspect files with read-only commands such as ls, rg and cat; they run in a sandbox. Never ask for approval or escalation: no one is available, and every request is declined.',
}

/** The working directory's files, for an agent that cannot list them itself. */
export interface InspectionFiles {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

/** The prompt, followed by the contract the agent's reply must meet. */
export function withOutputContract(
  prompt: string,
  schema: z.ZodType,
  agent: Provider,
  files?: InspectionFiles,
): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' }), null, 2)
  return [
    prompt.trimEnd(),
    '',
    '---',
    '',
    'Output contract:',
    '- Reply with only one JSON object that matches this JSON Schema, inside a ```json fenced block, and nothing else.',
    '- You may read files in the working directory. Do not create, edit or delete files, and do not run commands that change anything.',
    inspectionRules[agent],
    '- Always reply under this contract, even when you could not inspect everything. Say what you could not check in the reply rather than asking for permission.',
    '',
    '```json',
    jsonSchema,
    '```',
    ...(files && agent === Provider.claude ? fileListing(files) : []),
  ].join('\n')
}

function fileListing(files: InspectionFiles): string[] {
  return [
    '',
    files.truncated
      ? `Files in the working directory (the first ${String(files.paths.length)}):`
      : 'Files in the working directory:',
    '',
    ...files.paths,
  ]
}

/** The follow-up turn sent once when a reply does not meet the output contract. */
export function correctionPrompt(error: string): string {
  return [
    'Your reply did not match the output contract:',
    '',
    error,
    '',
    'Reply again with only one JSON object that matches the JSON Schema from the output contract, inside a ```json fenced block. If a tool was declined, answer from what you could read.',
  ].join('\n')
}

/**
 * Find the JSON object in the agent's replies and validate it. The newest reply that holds a
 * valid object wins; otherwise the error describes why the newest candidate failed.
 */
export function parseStructuredReply<T>(
  replies: readonly string[],
  schema: z.ZodType<T>,
): StructuredReply<T> {
  let failure: string | undefined
  for (const reply of replies.toReversed()) {
    const parsed = parseReply(reply, schema)
    if (parsed.success) return parsed
    failure ??= parsed.error
  }
  return { success: false, error: failure ?? 'The reply was empty.' }
}

function parseReply<T>(reply: string, schema: z.ZodType<T>): StructuredReply<T> {
  const candidates = jsonCandidates(reply)
  if (!candidates.length) return { success: false, error: 'The reply was empty.' }
  let failure: string | undefined
  for (const candidate of candidates) {
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch {
      failure ??= 'The reply did not contain valid JSON.'
      continue
    }
    const result = schema.safeParse(value)
    if (result.success) return { success: true, data: result.data }
    failure = truncate(`The JSON did not match the schema:\n${z.prettifyError(result.error)}`)
  }
  return { success: false, error: failure ?? 'The reply did not contain valid JSON.' }
}

/** Fenced blocks first, newest first, then the whole reply, then its outermost braces. */
function jsonCandidates(reply: string): string[] {
  const fenced = [...reply.matchAll(/```[a-zA-Z]*[^\S\n]*\n([\s\S]*?)```/g)]
    .map((match) => (match[1] ?? '').trim())
    .toReversed()
  const whole = reply.trim()
  const start = whole.indexOf('{')
  const end = whole.lastIndexOf('}')
  const braces = start !== -1 && end > start ? [whole.slice(start, end + 1)] : []
  return [...new Set([...fenced, whole, ...braces])].filter(Boolean)
}

function truncate(text: string): string {
  return text.length > MAX_STRUCTURED_ERROR_CHARS
    ? `${text.slice(0, MAX_STRUCTURED_ERROR_CHARS)}…`
    : text
}
