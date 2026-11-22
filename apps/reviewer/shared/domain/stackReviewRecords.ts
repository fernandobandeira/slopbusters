import { z } from 'zod'
import { decisionOptionSchema } from './stackDecisions'

const text = z.string().trim().min(1).max(12000)

export const stackAnswerSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('chosen'),
      optionId: text,
      note: text.optional(),
      reply: text.optional(),
    })
    .strict(),
  z.object({ state: z.literal('leftOpen'), note: text.optional() }).strict(),
])
export type StackAnswer = z.infer<typeof stackAnswerSchema>

export const stackDispositionSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('fixed'), evidence: text, checkedSha: text }).strict(),
  z.object({ state: z.literal('refuted'), evidence: text, checkedSha: text }).strict(),
  z.object({ state: z.literal('accepted'), reason: text }).strict(),
  z.object({ state: z.literal('assigned'), person: text }).strict(),
])
export type StackDisposition = z.infer<typeof stackDispositionSchema>

const revisionPairSchema = z.object({
  head: z.string().optional(),
  base: z.string().optional(),
})
export type RevisionPair = z.infer<typeof revisionPairSchema>
export const observedLayerSchema = revisionPairSchema.extend({ pull: z.number() })
export type ObservedLayer = z.infer<typeof observedLayerSchema>
const snapshotFields = {
  title: z.string(),
  entryIds: z.array(z.string()),
  layers: z.array(
    z.object({
      pull: z.number(),
      reviewed: revisionPairSchema,
      confirmed: revisionPairSchema.optional(),
    }),
  ),
}
const decisionSnapshotSchema = z.object({
  ...snapshotFields,
  question: z.string(),
  options: z.array(decisionOptionSchema),
})
const claimSnapshotSchema = z.object({
  ...snapshotFields,
  consequence: z.string(),
  impact: z.string(),
  standing: z.string(),
  contested: z.boolean(),
})
const recordFields = {
  sessionId: z.string(),
  itemId: z.string(),
  repository: z.string(),
  sourcePr: z.number(),
  targetPr: z.number().nullable(),
  revision: z.number().int().positive(),
  updatedAt: z.string(),
}
export const stackRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    ...recordFields,
    kind: z.literal('decision'),
    snapshot: decisionSnapshotSchema,
    answer: stackAnswerSchema.nullable(),
    disposition: z.null(),
  }),
  z.object({
    ...recordFields,
    kind: z.literal('serious_claim'),
    snapshot: claimSnapshotSchema,
    answer: z.null(),
    disposition: stackDispositionSchema.nullable(),
  }),
])
export type StackRecord = z.infer<typeof stackRecordSchema>
export type DecisionRecord = Extract<StackRecord, { kind: 'decision' }>
export type ClaimRecord = Extract<StackRecord, { kind: 'serious_claim' }>
export type DecisionSnapshot = DecisionRecord['snapshot']

export const decisionProvenanceSchema = z.object({
  sessionId: z.string(),
  decisionId: z.string(),
  revision: z.number().int().positive(),
  note: z.string().optional(),
})
export type DecisionProvenance = z.infer<typeof decisionProvenanceSchema>

export function dispositionSummary(disposition: StackDisposition): string {
  switch (disposition.state) {
    case 'fixed':
      return `Fixed and checked at ${disposition.checkedSha}. ${disposition.evidence}`
    case 'refuted':
      return `Refuted at ${disposition.checkedSha}. ${disposition.evidence}`
    case 'accepted':
      return `Accepted as a risk. ${disposition.reason}`
    case 'assigned':
      return `Assigned to ${disposition.person}. Still outstanding.`
  }
}

export function answerLabel(record: DecisionRecord): string | undefined {
  const { answer } = record
  if (answer?.state === 'leftOpen') return 'Left open'
  if (answer?.state === 'chosen')
    return record.snapshot.options.find(({ id }) => id === answer.optionId)?.label
}
