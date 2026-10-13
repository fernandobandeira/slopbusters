import { expect, it } from 'vitest'
import { z } from 'zod'
import {
  parseStructuredReply,
  withOutputContract,
} from '../server/adapters/t3Engine/structuredOutput'
import { Provider } from '../shared/domain/types'

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

  const claude = withOutputContract('Review this.', schema, Provider.claude, files)
  const codex = withOutputContract('Review this.', schema, Provider.codex, files)

  expect(claude).toContain('Do not use Bash or any other shell tool')
  expect(claude).toContain(
    'Files in the working directory (the first 2):\n\nREADME.md\nsrc/index.ts',
  )
  expect(codex).toContain('read-only commands such as ls, rg and cat')
  expect(codex).not.toContain('src/index.ts')
})
