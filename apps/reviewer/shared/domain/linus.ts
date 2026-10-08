import { z } from 'zod'
import type { OrganizationPreferences } from './preferences'
import type { PullRequest } from './types'

export const linusTourStepLimit = 3

export const expressionSchema = z.enum(['neutral', 'thinking', 'happy', 'resigned', 'angry'])
export const verdictSchema = z.enum(['keep', 'stack', 'separate', 'uncertain'])
export const adviceSchema = z
  .object({
    verdict: verdictSchema,
    reasoning: z.string().min(1).max(2000),
    revisedTitle: z.string().max(200),
    revisedDescription: z.string().max(16000),
    layers: z
      .array(
        z
          .object({
            title: z.string().min(1).max(200),
            reason: z.string().min(1).max(1500),
            dependsOn: z.array(z.number().int().min(1)).max(15),
            verification: z.string().min(1).max(1500),
          })
          .strict(),
      )
      .max(15),
    limitations: z.array(z.string().min(1).max(1500)).max(12),
    disagreements: z.array(z.string().min(1).max(1500)).max(8),
    steps: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            emotion: expressionSchema,
            target: z.enum(['overview', 'description', 'diff']),
            reference: z.string().max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(linusTourStepLimit),
  })
  .strict()

export type LinusAdvice = z.infer<typeof adviceSchema>
export type LinusStep = LinusAdvice['steps'][number]
export interface LinusResult {
  pull: PullRequest
  fingerprint: string
  advice: LinusAdvice
  reviewers: OrganizationPreferences[]
}
export interface LinusPending {
  pull: PullRequest
  fingerprint: string
  context?: string
  reviews: { model: OrganizationPreferences; advice?: LinusAdvice; error?: string }[]
}
export interface LinusSession {
  id: string
  repository: string
  urls: string[]
  primary: OrganizationPreferences
  companion: OrganizationPreferences
  status: 'running' | 'partial' | 'complete' | 'failed' | 'cancelled'
  progress: string
  results: LinusResult[]
  pending?: LinusPending
  error?: string
  createdAt: string
}

export interface LinusRecommendation {
  sessionId: string
  createdAt: string
  url: string
  number: number
  headSha: string
  verdict: LinusAdvice['verdict']
  recommendationCount: number
}

export interface LinusReplayRequest {
  sessionId: string
  url: string
}

export function validateAdvice(pull: PullRequest, input: unknown): LinusAdvice {
  const advice = adviceSchema.parse(input)
  const hunks = new Set(pull.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)))
  for (const step of advice.steps) {
    if (
      step.target === 'description' &&
      (!step.reference || !pull.description.includes(step.reference))
    )
      throw new Error('A recommendation referenced a passage outside this PR description.')
    if (step.target === 'diff' && !hunks.has(step.reference))
      throw new Error('A recommendation referenced a diff section outside this PR.')
    if (step.target === 'overview' && step.reference)
      throw new Error('An overview cannot reference a description or diff section.')
  }
  for (const [index, layer] of advice.layers.entries()) {
    if (
      new Set(layer.dependsOn).size !== layer.dependsOn.length ||
      layer.dependsOn.some((dependency) => dependency > index)
    )
      throw new Error('Proposed layers must depend only on earlier layers.')
  }
  if ((advice.verdict === 'keep' || advice.verdict === 'uncertain') && advice.layers.length)
    throw new Error('This recommendation does not call for new PR layers.')
  if ((advice.verdict === 'stack' || advice.verdict === 'separate') && advice.layers.length < 2)
    throw new Error('A split recommendation needs at least two reviewable parts.')
  if (
    (advice.verdict === 'stack' || advice.verdict === 'separate') &&
    !advice.steps.some((step) => step.target === 'diff')
  )
    throw new Error('A split recommendation must point to evidence in the diff.')
  if (advice.verdict === 'separate' && advice.layers.some((layer) => layer.dependsOn.length))
    throw new Error('Independent PRs cannot depend on each other.')
  if (advice.verdict === 'stack' && !advice.layers.some((layer) => layer.dependsOn.length))
    throw new Error('A stack must explain its dependencies.')
  return advice
}

export const verdictLabels: Record<LinusAdvice['verdict'], string> = {
  keep: 'Keep as one PR',
  stack: 'Split into a stack',
  separate: 'Separate independent changes',
  uncertain: 'More evidence needed',
}

export function recommendationsPrompt(results: LinusResult[]): string {
  return [
    'Apply the following Linus PR review recommendations. Inspect the current PR and repository instructions first. If its code or description differs from the reviewed snapshot, reassess the advice. Verify proposed changes before publishing. Propose any branch restructuring for approval before executing it.',
    ...results.map(({ pull, advice, reviewers, fingerprint }) =>
      [
        `PR #${pull.number}: ${pull.title}\n${pull.url}`,
        `Reviewed head: ${pull.headSha}\nReviewed base: ${pull.baseSha}\nSnapshot fingerprint (includes title and description): ${fingerprint}`,
        `Reviewers: ${reviewers.map((reviewer) => `${reviewer.provider} / ${reviewer.model}`).join(', ')}`,
        `${verdictLabels[advice.verdict]}\n${advice.reasoning}`,
        advice.revisedTitle && `Proposed title:\n${advice.revisedTitle}`,
        advice.revisedDescription && `Proposed description:\n${advice.revisedDescription}`,
        ...advice.layers.map(
          (layer, index) =>
            `${index + 1}. ${layer.title}\n${layer.reason}\nDepends on: ${layer.dependsOn.join(', ') || 'none'}\nVerification plan (not run): ${layer.verification}`,
        ),
        ...advice.steps.map(
          (step) =>
            `${step.text}${step.target !== 'overview' ? `\nEvidence (${step.target}): ${step.reference}` : ''}`,
        ),
        advice.limitations.length && `Limitations:\n${advice.limitations.join('\n')}`,
        advice.disagreements.length &&
          `Unresolved disagreements:\n${advice.disagreements.join('\n')}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    ),
  ].join('\n\n---\n\n')
}
