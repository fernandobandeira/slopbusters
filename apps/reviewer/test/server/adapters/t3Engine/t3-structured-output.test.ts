import { expect, it } from 'vitest'
import { z } from 'zod'
import {
  instructionsInFiles,
  overflowFiles,
  parseStructuredReply,
  withOutputContract,
  wrapLongLines,
} from '../../../../server/adapters/t3Engine/structuredOutput'
import { Provider } from '../../../../shared/domain/types'

const schema = z.object({ files: z.array(z.string()) })

it('reads the last fenced JSON block of a reply', () => {
  const reply = [
    'First draft:',
    '```json',
    '{"files":"wrong"}',
    '```',
    'Final answer:',
    '```json',
    '{"files":["a.ts"]}',
    '```',
  ].join('\n')

  expect(parseStructuredReply([reply], schema)).toEqual({
    success: true,
    data: { files: ['a.ts'] },
  })
})

it('accepts a bare JSON reply and JSON surrounded by prose', () => {
  expect(parseStructuredReply(['{"files":[]}'], schema)).toEqual({
    success: true,
    data: { files: [] },
  })
  expect(parseStructuredReply(['Result: {"files":["b"]} done'], schema)).toEqual({
    success: true,
    data: { files: ['b'] },
  })
})

it('prefers the newest reply that validates', () => {
  expect(parseStructuredReply(['{"files":["early"]}', 'All done.'], schema)).toEqual({
    success: true,
    data: { files: ['early'] },
  })
})

it('explains a schema mismatch so the agent can correct it', () => {
  const reply = parseStructuredReply(['```json\n{"files":"a.ts"}\n```'], schema)

  expect(reply.success).toBe(false)
  expect(!reply.success && reply.error).toMatch(/did not match the schema[\s\S]*files/)
})

it("lists the copy's files for Claude, which has no search tool, and lets Codex use its sandbox", () => {
  const files = { paths: ['README.md', 'src/index.ts'], truncated: true }

  const claude = withOutputContract('Review this.', schema, Provider.claude, { files })
  const codex = withOutputContract('Review this.', schema, Provider.codex, { files })

  expect(claude).toContain('Do not use Bash or any other shell tool')
  expect(claude).toContain(
    'Files in the working directory (the first 2):\n\nREADME.md\nsrc/index.ts',
  )
  expect(codex).toContain('read-only commands such as ls, rg and cat')
  expect(codex).not.toContain('src/index.ts')
})

it('wraps only lines longer than the read tools show whole, keeping every character', () => {
  const text = `short\n${'a'.repeat(1200)}\nend`

  const wrapped = wrapLongLines(text)

  expect(wrapped.split('\n').map((line) => line.length)).toEqual([5, 500, 500, 200, 3])
  expect(wrapped.replaceAll('\n', '')).toBe(text.replaceAll('\n', ''))
})

it('tells each agent how to read instructions that live in a file', () => {
  const claude = instructionsInFiles(overflowFiles('one\ntwo', Provider.claude), Provider.claude)
  const codex = instructionsInFiles(overflowFiles('one\ntwo', Provider.codex), Provider.codex)

  expect(claude).toContain(
    'in the file .slopbusters/instructions.md in the working directory (2 lines)',
  )
  expect(claude).toContain('Read tool, 150 lines at a time')
  expect(codex).toContain('one `cat` command in its own tool call')
})

it('gives Codex long instructions as parts one read shows whole, and Claude one file', () => {
  const line = 'x'.repeat(399)
  const text = Array.from({ length: 200 }, () => line).join('\n')

  const codex = overflowFiles(text, Provider.codex)
  const claude = overflowFiles(text, Provider.claude)

  expect(codex.map((part) => part.path)).toEqual([
    '.slopbusters/instructions-1.md',
    '.slopbusters/instructions-2.md',
    '.slopbusters/instructions-3.md',
  ])
  expect(codex.every((part) => part.text.length <= 32_000)).toBe(true)
  expect(codex.map((part) => part.text).join('\n')).toBe(text)
  expect(claude).toEqual([{ path: '.slopbusters/instructions.md', text }])
  expect(instructionsInFiles(codex, Provider.codex)).toContain(
    'in 3 files in the working directory, 200 lines in all',
  )
})
