import { describe, expect, it, vi } from 'vitest'
import { createStackResolver } from '../../../../server/features/stack-review/stackResolution'
import type { PullStack, PullStackResult } from '../../../../shared/domain/stacks'
import { layerUrl, stackRepository } from '../../../fixtures/stackReview'

const signal = () => new AbortController().signal
const stack: PullStack = {
  id: 'stack',
  source: 'github',
  baseBranch: 'main',
  position: 2,
  size: 3,
  warnings: [],
  items: [201, 202, 203].map((number) => ({
    number,
    title: `Layer ${String(number)}`,
    url: layerUrl(number),
    repository: stackRepository,
    headBranch: `layer-${String(number)}`,
    baseBranch: number === 201 ? 'main' : `layer-${String(number - 1)}`,
    state: 'open' as const,
    isDraft: false,
  })),
}
const resolving = (result: PullStackResult) => createStackResolver(() => Promise.resolve(result))

describe('resolving the stack to review', () => {
  it('lists the open layers bottom to top from any layer, reading the stack afresh', async () => {
    const getStack = vi.fn(() =>
      Promise.resolve({
        stack: {
          ...stack,
          items: stack.items.map((layer) =>
            layer.number === 201 ? { ...layer, state: 'merged' as const } : layer,
          ),
        },
        warnings: [],
      }),
    )

    const layers = await createStackResolver(getStack)(`${layerUrl(203)}/files`, signal())

    expect(getStack).toHaveBeenCalledWith(`${layerUrl(203)}/files`, true)
    expect(layers).toEqual([
      { url: layerUrl(202), number: 202, title: 'Layer 202' },
      { url: layerUrl(203), number: 203, title: 'Layer 203' },
    ])
  })

  it('refuses an incomplete or ambiguous stack with what GitHub said', async () => {
    const incomplete = resolving({
      stack: null,
      incomplete: true,
      warnings: ['The parent of #202 is ambiguous.'],
    })

    await expect(incomplete(layerUrl(202), signal())).rejects.toThrow(
      'The stack of PR #202 could not be loaded safely. The parent of #202 is ambiguous. Refresh it and retry.',
    )
  })

  it('refuses a PR that is not in a stack, and layers that do not form one chain', async () => {
    const alone = resolving({ stack: null, warnings: [] })
    const broken = resolving({
      stack: {
        ...stack,
        items: stack.items.map((layer) =>
          layer.number === 203 ? { ...layer, baseBranch: 'elsewhere' } : layer,
        ),
      },
      warnings: [],
    })

    await expect(alone(layerUrl(202), signal())).rejects.toThrow(
      'PR #202 is not part of a stack. Ask the panel to review it on its own.',
    )
    await expect(broken(layerUrl(202), signal())).rejects.toThrow(
      'The open stack layers do not form a continuous branch chain.',
    )
  })
})
