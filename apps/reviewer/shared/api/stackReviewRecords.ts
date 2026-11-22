import { z } from 'zod'
import {
  observedLayerSchema,
  stackAnswerSchema,
  stackDispositionSchema,
  stackRecordSchema,
} from '../domain/stackReviewRecords'
import { defineRoute, idParams } from './contract'

export const decisionIdSchema = z.string().min(1).max(4000)
const expectedRevision = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1)
const versionedDecision = z.object({ decisionId: decisionIdSchema, expectedRevision })
const response = z.object({
  records: z.array(stackRecordSchema),
  applied: z.array(z.string()),
  revisions: z.array(observedLayerSchema),
})
const path = '/stack-review/:id/records'

export const getStackRecords = defineRoute('GET', path, { params: idParams, response })
export const putStackAnswer = defineRoute('PUT', path + '/answer', {
  params: idParams,
  request: versionedDecision
    .extend({ answer: stackAnswerSchema, confirm: z.array(observedLayerSchema).min(1).optional() })
    .strict(),
  response,
})
export const putStackAnswers = defineRoute('PUT', path + '/bulk', {
  params: idParams,
  request: z
    .object({
      answers: z
        .array(versionedDecision.extend({ optionId: decisionIdSchema }).strict())
        .min(1)
        .max(1000),
    })
    .strict(),
  response,
})
export const reopenStackAnswer = defineRoute('POST', path + '/reopen', {
  params: idParams,
  request: versionedDecision.strict(),
  response,
})
export const putStackDisposition = defineRoute('PUT', path + '/disposition', {
  params: idParams,
  request: z
    .object({
      claimId: decisionIdSchema,
      expectedRevision,
      disposition: stackDispositionSchema.nullable(),
    })
    .strict(),
  response,
})
export type AnswerWrite = z.input<typeof putStackAnswer.request>
export type BulkWrite = z.input<typeof putStackAnswers.request>['answers']
export type DispositionWrite = z.input<typeof putStackDisposition.request>
export type StackRecordsRead = z.output<typeof response>
