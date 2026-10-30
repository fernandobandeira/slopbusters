import { z } from 'zod'
import { MAX_STRUCTURED_ERROR_CHARS } from './limits'
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

/**
 * Claude Code runs the read-only Git commands it recognises without asking, so in a copy that
 * keeps its Git metadata Claude may try them; anything else it asks for is still declined.
 */
const gitRules: Record<Provider, string> = {
  claude:
    '- Read files by path with the Read tool; any files in the working directory are listed below. The working directory is a Git checkout: you may run read-only Git commands such as git diff, git log, git show and git blame. Every other shell command is declined here.',
  codex:
    '- Inspect files and history with read-only commands such as ls, rg, cat, git diff, git log, git show and git blame; they run in a sandbox. Never ask for approval or escalation: no one is available, and every request is declined.',
}

/** What the agent may do in its working directory. */
export interface CopyAccess {
  /** The copy keeps its Git metadata, so the agent can read history, the index and diffs. */
  readonly git?: boolean
  /** The agent makes its changes by editing files in the copy. */
  readonly editable?: boolean
}

function accessRules(agent: Provider, access: CopyAccess): string[] {
  const changes = access.editable
    ? '- Your working directory is a disposable copy. Make the changes the task asks for by editing files there in place. Do not run commands that change anything else, and do not ask for approval.'
    : '- You may read files in the working directory. Do not create, edit or delete files, and do not run commands that change anything.'
  return [changes, (access.git ? gitRules : inspectionRules)[agent]]
}

/** The working directory's files, for an agent that cannot list them itself. */
export interface InspectionFiles {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

/** The file list, inline or, when it does not fit in the message, in a file. */
export type FileListing = InspectionFiles | { readonly path: string; readonly count: number }

/** Where the runner leaves what does not fit in one engine message, in the working directory. */
export const OVERFLOW_DIRECTORY = '.slopbusters'

/** Longest line in an overflow file; Claude's Read and Codex's command output show it whole. */
const MAX_OVERFLOW_LINE_CHARS = 500

/** How each agent reads a long file: in order, in chunks its tool shows without truncating. */
const chunkedReading: Record<Provider, string> = {
  claude: 'Read it with the Read tool, 150 lines at a time, using offset and limit.',
  codex: "Read it with `sed -n 'START,ENDp'`, 20 lines at a time.",
}

/** The prompt, followed by the contract the agent's reply must meet. */
export function withOutputContract(
  prompt: string,
  schema: z.ZodType,
  agent: Provider,
  { files, access = {} }: { files?: FileListing; access?: CopyAccess } = {},
): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' }), null, 2)
  return [
    prompt.trimEnd(),
    '',
    '---',
    '',
    'Output contract:',
    '- Reply with only one JSON object that matches this JSON Schema, inside a ```json fenced block, and nothing else.',
    ...accessRules(agent, access),
    '- Always reply under this contract, even when you could not inspect everything. Say what you could not check in the reply rather than asking for permission.',
    '',
    '```json',
    jsonSchema,
    '```',
    ...(files && agent === Provider.claude ? fileListing(files) : []),
  ].join('\n')
}

function fileListing(files: FileListing): string[] {
  if ('path' in files)
    return [
      '',
      `The ${String(files.count)} files in the working directory are listed in ${files.path}, one per line.`,
    ]
  return [
    '',
    files.truncated
      ? `Files in the working directory (the first ${String(files.paths.length)}):`
      : 'Files in the working directory:',
    '',
    ...files.paths,
  ]
}

/**
 * The message that stands in for instructions too long for one engine message; they are written
 * to `path`, wrapped by `wrapLongLines`.
 */
export function instructionsInFile(path: string, instructions: string, agent: Provider): string {
  const lines = instructions.split('\n').length
  return [
    `Your instructions are too long to send in one message, so they are in the file ${path} in the working directory (${String(lines)} lines). Read the whole file, in order, before you answer; it is the task.`,
    chunkedReading[agent],
    `Lines longer than ${String(MAX_OVERFLOW_LINE_CHARS)} characters continue on the next line: join them back when you read JSON.`,
  ].join('\n\n')
}

/** Split lines longer than the agents' read tools show whole; nothing else changes. */
export function wrapLongLines(text: string): string {
  return text
    .split('\n')
    .flatMap((line) =>
      line.length <= MAX_OVERFLOW_LINE_CHARS
        ? [line]
        : Array.from({ length: Math.ceil(line.length / MAX_OVERFLOW_LINE_CHARS) }, (_, index) =>
            line.slice(index * MAX_OVERFLOW_LINE_CHARS, (index + 1) * MAX_OVERFLOW_LINE_CHARS),
          ),
    )
    .join('\n')
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

/** The turn that sends problems the caller found in the copy back to the agent. */
export function followUpPrompt(problems: string): string {
  return [
    problems.trimEnd(),
    '',
    'Fix this in the working directory, then reply again with only one JSON object that matches the JSON Schema from the output contract, inside a ```json fenced block.',
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
