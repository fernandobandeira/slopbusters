import { expect, it, vi } from 'vitest'
import { LayerFixTools } from '../../../../server/features/mcp/layerFixTools'
import { fixtureLayerFix } from '../../../fixtures/layerFix'
import { finishedStackReview, layerUrl, stackEntry } from '../../../fixtures/stackReview'

it('starts the selected layer and states where commits live and that nothing is pushed', async () => {
  const session = fixtureLayerFix()
  const start = vi.fn(() => Promise.resolve(session))
  const tools = new LayerFixTools(
    { start, latest: () => undefined },
    { latest: () => finishedStackReview([stackEntry(201, 'g1')]) },
  )
  const text = await tools.apply(layerUrl(201), ['#201/g1'])
  expect(start).toHaveBeenCalledWith('stack-1', layerUrl(201), ['#201/g1'])
  expect(text).toContain('commits locally in an app-owned worktree and pushes nothing')
  expect(text).toContain('pnpm test: observed exit 0')
  expect(text).toContain('Handles missing data.')
})
it('reads the persisted outcome without starting another worker', async () => {
  const tools = new LayerFixTools(
    { start: vi.fn(), latest: () => fixtureLayerFix() },
    { latest: () => undefined },
  )
  expect(await tools.read(layerUrl(201), 0, new AbortController().signal)).toContain('done:')
})
