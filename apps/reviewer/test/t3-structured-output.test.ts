import { expect, it } from 'vitest'
import { z } from 'zod'
import { parseStructuredReply } from '../server/adapters/t3Engine/structuredOutput'

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
