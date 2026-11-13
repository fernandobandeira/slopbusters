import type { LayerFixSession } from '../../shared/domain/layerFix'
import { modelPair } from '../../shared/domain/preferences'
import { Provider } from '../../shared/domain/types'
import { layerUrl } from './stackReview'

export function fixtureLayerFix(changes: Partial<LayerFixSession> = {}): LayerFixSession {
  const models = modelPair(Provider.codex)
  return {
    id: 'fix-run',
    stack: 'stack-1',
    urls: [layerUrl(201)],
    url: layerUrl(201),
    createdAt: '2026-11-13T10:00:00Z',
    status: 'complete',
    outcome: 'done',
    progress: 'Fixes committed locally. Nothing pushed.',
    start: 'a'.repeat(40),
    base: 'c'.repeat(40),
    fixes: [
      {
        id: '#201/g1',
        title: 'Handle missing data',
        plan: 'Return an empty list.',
        reason: 'Missing input crashes.',
      },
    ],
    model: models.primary,
    checker: models.companion,
    correctionUsed: false,
    commands: [{ id: 'check', input: 'pnpm test', exitCode: 0 }],
    commits: ['b'.repeat(40)],
    left: ['Update the title'],
    results: [
      {
        entry: '#201/g1',
        status: 'applied',
        note: 'Handles missing data.',
        evidence: ['src/job.ts:8'],
      },
    ],
    thread: { threadId: 'thread-1', messageId: 'message-1', runtimeMode: 'full-access' },
    ...changes,
  }
}
