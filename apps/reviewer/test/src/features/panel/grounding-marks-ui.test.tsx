// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { markEntries } from '../../../../shared/domain/groundingResult'
import { GroundingVerdict } from '../../../../src/features/panel/GroundingNotes'
import { groundedEntry, groundedResult, groundedSource } from '../../../fixtures/grounding'

afterEach(cleanup)

describe('a grounded entry the consistency check marked', () => {
  it('shows the earlier request it would undo and the finding it opposes', () => {
    const resolved = markEntries([groundedEntry('g1', 'f1'), groundedEntry('g2', 'f2')], {
      reversals: [{ entry: 'g1', earlier: 'e1', reason: 'It brings the two flags back.' }],
      conflicts: [{ entries: ['g1', 'g2'], reason: 'One folds the flag, one splits it.' }],
    })
    const result = groundedResult(resolved, {
      candidates: [groundedSource('f1', 'Fold the flag'), groundedSource('f2', 'Split the flag')],
      earlier: {
        requests: [
          {
            key: 'e1',
            round: '2026-11-18',
            entry: 'g4',
            title: 'Use one field',
            plan: 'Replace the flags with one field.',
            reason: 'The flags contradict.',
            asked: 'fix',
          },
        ],
        left: 0,
      },
    })

    render(<GroundingVerdict result={result} id="g1" />)

    expect(
      screen.getByText(/^Your call: Would undo a change an earlier round asked for\./),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'g4 from the round of 2026-11-18, "Use one field": Replace the flags with one field. It brings the two flags back.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('g2: One folds the flag, one splits it.')).toBeTruthy()
  })
})
