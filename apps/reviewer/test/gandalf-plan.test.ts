import { describe, expect, it, vi } from 'vitest'
import { createGandalfPlanner } from '../server/features/gandalf/gandalfPlan'
import type { PullStack, PullStackResult } from '../shared/domain/stacks'

const url = (number: number) => `https://github.com/example/project/pull/${number}`
const stack: PullStack = {
  id: 'stack',
  source: 'github',
  baseBranch: 'main',
  position: 1,
  size: 3,
  warnings: [],
  items: [1, 2, 3].map(layer),
}
function layer(number: number) {
  return {
    number,
    title: `Layer ${number}`,
    url: url(number),
    repository: 'example/project',
    headBranch: `layer-${number}`,
    baseBranch: number === 1 ? 'main' : `layer-${number - 1}`,
    state: 'open' as const,
    isDraft: false,
  }
}
const signal = () => new AbortController().signal

describe('Gandalf dependency planning', () => {
  it('expands a reversed selection to the full stack bottom-up, including a clean middle layer', async () => {
    const getStack = vi.fn(() => Promise.resolve({ stack, warnings: [] }))
    expect(await createGandalfPlanner(getStack)([url(3), url(1)], signal())).toEqual([
      url(1),
      url(2),
      url(3),
    ])
    expect(getStack).toHaveBeenCalledTimes(1)
    expect(getStack).toHaveBeenCalledWith(url(3), true)
  })
  it('handles independent PRs and multiple stacks without duplicating layers', async () => {
    const other = {
      ...stack,
      items: stack.items.map((layer) => ({
        ...layer,
        number: layer.number + 10,
        url: url(layer.number + 10),
      })),
    }
    const getStack = vi.fn((selected: string): Promise<PullStackResult> =>
      Promise.resolve({
        stack: selected === url(9) ? null : selected === url(13) ? other : stack,
        warnings: [],
      }),
    )
    expect(
      await createGandalfPlanner(getStack)([url(9), url(3), url(13), url(2)], signal()),
    ).toEqual([url(9), url(1), url(2), url(3), url(11), url(12), url(13)])
  })
})

describe('Gandalf dependency validation', () => {
  it('omits merged layers and refuses discontinuous or ambiguous chains', async () => {
    const merged: PullStack = {
      ...stack,
      items: stack.items.map((layer) =>
        layer.number === 1 ? { ...layer, state: 'merged' } : layer,
      ),
    }
    expect(
      await createGandalfPlanner(() => Promise.resolve({ stack: merged, warnings: [] }))(
        [url(3)],
        signal(),
      ),
    ).toEqual([url(2), url(3)])
    for (const invalid of [
      { ...stack, warnings: ['The parent is ambiguous.'] },
      {
        ...stack,
        items: stack.items.map((layer) =>
          layer.number === 2 ? { ...layer, baseBranch: 'another-parent' } : layer,
        ),
      },
      {
        ...stack,
        items: stack.items.map((layer) =>
          layer.number === 2 ? { ...layer, state: 'closed' as const } : layer,
        ),
      },
    ])
      await expect(
        createGandalfPlanner(() =>
          Promise.resolve({
            stack: invalid,
            warnings: [],
            incomplete: invalid.warnings.length > 0,
          }),
        )([url(3)], signal()),
      ).rejects.toThrow()
  })
  it('stops when known native stack details are unavailable instead of resolving the selection independently', async () => {
    const plan = createGandalfPlanner(() =>
      Promise.resolve({
        stack: null,
        incomplete: true,
        warnings: ['GitHub reports a native stack, but its layers could not be loaded.'],
      }),
    )
    await expect(plan([url(3)], signal())).rejects.toThrow('stack could not be loaded safely')
  })
  it('rejects foreign layers and oversized expanded stacks before updating any branch', async () => {
    for (const items of [
      stack.items.map((layer) => ({
        ...layer,
        url: layer.url.replace('example/project', 'other/repo'),
      })),
      Array.from({ length: 21 }, (_, index) => layer(index + 1)),
    ])
      await expect(
        createGandalfPlanner(() => Promise.resolve({ stack: { ...stack, items }, warnings: [] }))(
          [url(1)],
          signal(),
        ),
      ).rejects.toThrow()
  })
})
