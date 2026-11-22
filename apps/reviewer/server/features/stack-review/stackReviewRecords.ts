import { createCache } from '../../cache'
import type {
  AnswerWrite,
  BulkWrite,
  DispositionWrite,
  StackRecordsRead,
} from '../../../shared/api/stackReviewRecords'
import { stackBrief, type StackBrief } from '../../../shared/domain/stackBrief'
import { claimSnapshot, decisionSnapshot } from '../../../shared/domain/stackDecisionSnapshot'
import { buildStackBrief, bulkDefaults } from '../../../shared/domain/projectStackBrief'
import type {
  DecisionRecord,
  RevisionPair,
  StackAnswer,
  StackRecord,
} from '../../../shared/domain/stackReviewRecords'
import type { StackReviewSession } from '../../../shared/domain/stackReview'
import type { StackReviewRecordStore } from '../../adapters/stackReviewRecordStore'
import { isDeepStrictEqual } from 'node:util'
import { logError, UserError } from '../../errors'

interface Options {
  store: Pick<StackReviewRecordStore, 'read' | 'write'>
  get: (id: string) => StackReviewSession
  applied: (id: string) => string[]
  revision: (url: string) => Promise<Required<RevisionPair>>
}
interface Review {
  session: StackReviewSession
  brief: StackBrief
  projected: StackBrief
  data: StackRecordsRead
}

export class StackReviewRecords {
  private readonly inFlight = createCache<Required<RevisionPair>>({ max: 0 })

  constructor(private readonly options: Options) {}

  async read(id: string): Promise<StackRecordsRead> {
    return (await this.review(id)).data
  }

  async brief(session: StackReviewSession, forWorker = false): Promise<StackBrief> {
    return (await this.review(session.id, forWorker ? 'worker' : 'bestEffort')).projected
  }

  async answer(id: string, write: AnswerWrite): Promise<StackRecordsRead> {
    const review = await this.review(id, write.confirm ? 'required' : 'bestEffort')
    const record = answerRecord(review, write, write.answer, Boolean(write.confirm))
    if (write.confirm) verifyConfirmation(review, write)
    return this.save(review, [record])
  }

  async bulk(id: string, writes: BulkWrite): Promise<StackRecordsRead> {
    const review = await this.review(id, 'required')
    const eligible = new Map(
      bulkDefaults(review.projected, review.projected.decisions).map((item) => [
        item.decisionId,
        item,
      ]),
    )
    const ids = new Set<string>()
    const records = writes.map((write) => {
      if (ids.has(write.decisionId))
        throw new UserError('A decision may appear only once per bulk action.')
      ids.add(write.decisionId)
      const record = answerRecord(review, write, { state: 'chosen', optionId: write.optionId })
      if (eligible.get(write.decisionId)?.optionId !== write.optionId)
        throw new UserError(
          'Choose defaults only for unanswered, current decisions without a serious consequence.',
        )
      return record
    })
    return this.save(review, records)
  }

  async reopen(
    id: string,
    write: Omit<AnswerWrite, 'answer' | 'confirm'>,
  ): Promise<StackRecordsRead> {
    const review = await this.review(id)
    const record = answerRecord(review, write, null)
    if (!review.projected.review?.answered.some(({ decision }) => decision.id === write.decisionId))
      throw new UserError('That decision is already open.')
    return this.save(review, [record])
  }

  async disposition(id: string, write: DispositionWrite): Promise<StackRecordsRead> {
    const review = await this.review(id)
    const claim = review.brief.serious.find((item) => item.id === write.claimId)
    if (!claim) throw new UserError('That serious consequence is no longer in this brief.', 404)
    checkRevision(review, 'serious_claim', claim.id, write.expectedRevision)
    const snapshot = claimSnapshot(review.brief, claim)
    return this.save(review, [
      {
        ...recordIdentity(review, claim.id, claim.layer, write.expectedRevision),
        kind: 'serious_claim',
        snapshot,
        targetPr: claim.relatedLayers.find((pull) => pull !== claim.layer) ?? null,
        answer: null,
        disposition: write.disposition,
      },
    ])
  }

  /** MCP creates an answer from the author's choice. An existing answer must be reopened in the UI. */
  async recordChoice(
    id: string,
    decisionId: string,
    optionId: string,
    note?: string,
  ): Promise<void> {
    const review = await this.review(id)
    const pending = review.projected.review?.pending.get(decisionId)
    if (!pending) {
      if (review.projected.review?.answered.some(({ decision }) => decision.id === decisionId))
        throw new UserError(
          'This decision is already answered. Reopen it in the app before recording a new answer.',
        )
      throw new UserError(
        'Unknown decision ID. Find decision IDs under Needs your decision in get_stack_review.',
      )
    }
    const record = answerRecord(
      review,
      { decisionId, expectedRevision: pending.revision },
      { state: 'chosen', optionId, note },
    )
    this.save(review, [record])
  }

  private save(review: Review, records: StackRecord[]) {
    this.options.store.write(records)
    return { ...review.data, records: this.options.store.read(review.session.id) }
  }

  private async review(
    id: string,
    revisionsMode: 'required' | 'bestEffort' | 'worker' = 'bestEffort',
  ): Promise<Review> {
    const session = this.options.get(id)
    const brief = session.status === 'complete' ? stackBrief(session) : undefined
    if (!brief) throw new UserError('Wait for the stack review to finish.')
    const checkRevisions = brief.decisions.length > 0 || brief.serious.length > 0
    const revisions = checkRevisions ? await this.revisions(brief) : []
    const records = this.options.store.read(id)
    const applied = this.options.applied(id)
    if (
      checkRevisions &&
      revisions.length !== brief.layers.length &&
      requiresRevisions(revisionsMode, records)
    )
      throw new UserError('Could not check the current layer revisions. Try again.')
    const data = { revisions, records, applied }
    const projected = buildStackBrief(session, data)
    if (!projected) throw new UserError('Wait for the stack review to finish.')
    return { session, ...projected, data }
  }

  private async revisions(brief: StackBrief): Promise<StackRecordsRead['revisions']> {
    const updated = await Promise.all(
      brief.layers.map(async ({ number, url }) => {
        try {
          const revision = await this.inFlight.load(url, () => this.options.revision(url))
          return { pull: number, ...revision }
        } catch (error) {
          logError('Could not check layer revisions for stack review records.', error)
          return undefined
        }
      }),
    )
    return updated.filter((revision) => revision !== undefined)
  }
}

function requiresRevisions(mode: 'required' | 'bestEffort' | 'worker', records: StackRecord[]) {
  return (
    mode === 'required' ||
    (mode === 'worker' && records.some((record) => record.answer?.state === 'chosen'))
  )
}

function verifyConfirmation(review: Review, write: AnswerWrite) {
  const answered = review.projected.review?.answered.find(
    ({ decision }) => decision.id === write.decisionId,
  )
  if (!answered?.confirmableAt)
    throw new UserError(
      'Only an answer marked for recheck can be confirmed. Reopen it if the question changed.',
    )
  if (
    !isDeepStrictEqual(answered.confirmableAt, write.confirm) ||
    !isDeepStrictEqual(answered.record.answer, write.answer)
  )
    throw new UserError(
      'The answer or layer revisions changed. Reload and recheck before confirming.',
      409,
    )
}

function answerRecord(
  review: Review,
  { decisionId, expectedRevision }: Omit<AnswerWrite, 'answer'>,
  answer: StackAnswer | null,
  confirm = false,
): DecisionRecord {
  const decision = review.brief.decisions.find(({ id }) => id === decisionId)
  if (!decision) throw new UserError('That decision is no longer in this brief.', 404)
  checkRevision(review, 'decision', decisionId, expectedRevision)
  const snapshot = decisionSnapshot(review.brief, decision, confirm)
  const option = selectedOption(snapshot.options, answer)
  return {
    ...recordIdentity(review, decisionId, decision.layer, expectedRevision),
    kind: 'decision',
    snapshot,
    targetPr: option?.change?.structure?.into ?? option?.change?.layer ?? null,
    answer:
      answer?.state === 'chosen' ? { ...answer, reply: answer.reply ?? option?.reply } : answer,
    disposition: null,
  }
}

function selectedOption(
  options: DecisionRecord['snapshot']['options'],
  answer: StackAnswer | null,
) {
  if (answer?.state !== 'chosen') return
  const option = options.find(({ id }) => id === answer.optionId)
  if (!option)
    throw new UserError(
      `Unknown option ID. Choose one of: ${options.map(({ id }) => id).join(', ')}.`,
    )
  return option
}

function checkRevision(
  review: Review,
  kind: DecisionRecord['kind'] | 'serious_claim',
  id: string,
  expected: number,
) {
  const record = review.data.records.find(
    (item) => item.sessionId === review.session.id && item.kind === kind && item.itemId === id,
  )
  if ((record?.revision ?? 0) !== expected)
    throw new UserError('This record changed in another tab. Reload it and try again.', 409)
}

function recordIdentity(
  { session }: Review,
  itemId: string,
  sourcePr: number,
  expectedRevision: number,
) {
  return {
    sessionId: session.id,
    itemId,
    sourcePr,
    repository: session.repository,
    revision: expectedRevision + 1,
    updatedAt: new Date().toISOString(),
  }
}
