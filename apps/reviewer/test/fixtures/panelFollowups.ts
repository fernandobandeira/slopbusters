import type { PanelSession } from '../../shared/domain/panelSession'
import { groundedAdvice } from '../../shared/domain/groundingResult'
import { selectCandidates, type ResolvedEntry } from '../../shared/domain/grounding'
import { DiffSide, Provider } from '../../shared/domain/types'
import { fixturePanelAdvice, fixturePanelFinding } from './panel'
import { fixturePull } from './pull'

export function followUpSession(): PanelSession {
  const pull = fixturePull()
  const model = { provider: Provider.codex, model: 'example-model' }
  const resolved: ResolvedEntry[] = ['g1', 'g2'].map((id, index) => ({
    id,
    sources: [`f${String(index + 1)}`],
    verdict: 'legit',
    reason: 'The retry can lose the audit row.',
    evidence: ['src/audit.ts:4'],
    plan: 'Persist the row before retrying.',
    origin: 'preexisting',
    kind: 'defect',
    resolution: 'agreed',
    raisedBy: ['seat-example'],
    destination: { kind: 'code', pull: pull.number },
  }))
  const grounding = {
    budget: 2,
    candidates: selectCandidates(
      pull.number,
      [
        {
          reviewer: 'seat-example',
          advice: fixturePanelAdvice(
            ['Retain the audit row', 'Keep the retry key'].map((title, index) =>
              fixturePanelFinding({
                id: `f${String(index + 1)}`,
                title,
                anchor: { kind: 'context', path: 'src/audit.ts', line: 4, side: DiffSide.right },
                suggestion: 'Persist the row before retrying.',
                body: 'Example Reviewer: the retry loses the row.',
              }),
            ),
          ),
        },
      ],
      2,
    ),
    roles: { primary: model },
    turns: [],
    entries: resolved,
    positions: {},
    resolved,
  }
  return {
    id: 'follow-up-panel',
    repository: `${pull.owner}/${pull.repo}`,
    urls: [pull.url],
    model,
    reviewers: [{ id: 'seat-example', name: 'Example Reviewer', maxFindings: 5 }],
    status: 'complete',
    progress: 'Finished.',
    createdAt: '2026-01-01',
    results: [
      {
        pull,
        fingerprint: 'snapshot',
        reviews: [],
        grounding,
        advice: groundedAdvice(grounding, { summary: 'Two follow-ups.', limitations: [] }),
      },
    ],
  }
}
