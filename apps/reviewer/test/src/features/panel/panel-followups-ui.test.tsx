// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import { GroundingVerdict } from '../../../../src/features/panel/GroundingNotes'
import {
  PanelFollowupProvider,
  FollowupSummaryAction,
} from '../../../../src/features/panel/PanelFollowups'
import { call } from '../../../../src/lib/api'
import { followUpSession } from '../../../fixtures/panelFollowups'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const team = { id: 'example-team', name: 'Example Team', key: 'DEMO' }

function setup(connected = true, linked = true) {
  const session = followUpSession()
  const result = session.results[0]!
  const replace = vi.fn()
  vi.mocked(call).mockImplementation((route: ApiContract) => {
    if (route === routes.getLinearStatus) return Promise.resolve({ connected })
    if (route === routes.panelFollowUpOptions)
      return Promise.resolve({
        teams: [team],
        linked: linked
          ? {
              id: 'issue',
              identifier: 'DEMO-10',
              url: 'https://linear.app/demo/issue/DEMO-10',
              team,
            }
          : null,
      })
    if (route === routes.filePanelFollowUps) return Promise.resolve({ session, failures: [] })
    return Promise.reject(new Error('Unexpected request'))
  })
  const view = (filed = false) => {
    if (filed)
      result.followUps = [
        {
          entry: 'g1',
          identifier: 'DEMO-21',
          url: 'https://linear.app/demo/issue/DEMO-21',
          filedAt: '2026-01-01',
        },
      ]
    return (
      <PanelFollowupProvider sessionId={session.id} result={result} replace={replace}>
        <GroundingVerdict result={result} id="g1" />
        <FollowupSummaryAction result={result} />
      </PanelFollowupProvider>
    )
  }
  const rendered = render(view())
  return { ...rendered, replace, session, view }
}

describe('panel follow-up actions', () => {
  it('files one finding after showing its title and inherited team, then shows the ticket', async () => {
    const { replace, session, rerender, view } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'File follow-up in Linear' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Retain the audit row')).toBeTruthy()
    expect(await within(dialog).findByText('Team: Example Team (DEMO)')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm follow-ups' }))
    await vi.waitFor(() => {
      expect(replace).toHaveBeenCalledWith(session)
    })
    expect(call).toHaveBeenCalledWith(routes.filePanelFollowUps, {
      params: { id: session.id },
      body: { url: session.urls[0], entries: ['g1'] },
    })
    rerender(view(true))
    expect(screen.getByRole('link', { name: 'DEMO-21' }).getAttribute('href')).toContain('/DEMO-21')
    expect(screen.queryByRole('button', { name: 'File follow-up in Linear' })).toBeNull()
  })

  it('confirms every unfiled title and requires a team when there is no linked ticket', async () => {
    setup(true, false)
    fireEvent.click(await screen.findByRole('button', { name: 'File 2 follow-ups' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Retain the audit row')).toBeTruthy()
    expect(within(dialog).getByText('Keep the retry key')).toBeTruthy()
    const picker = await screen.findByRole('combobox', { name: 'Follow-up team' })
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm follow-ups' }).disabled,
    ).toBe(true)
    expect(vi.mocked(call).mock.calls.some(([route]) => route === routes.filePanelFollowUps)).toBe(
      false,
    )
    fireEvent.change(picker, { target: { value: team.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm follow-ups' }))
    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledWith(
        routes.filePanelFollowUps,
        expect.objectContaining({
          body: expect.objectContaining({ entries: ['g1', 'g2'], team: team.id }) as unknown,
        }),
      )
    })
  })

  it('hides filing actions without Linear connected', async () => {
    setup(false)
    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledWith(routes.getLinearStatus, {}, expect.anything())
    })
    expect(screen.queryByRole('button', { name: /File/ })).toBeNull()
    expect(
      vi.mocked(call).mock.calls.some(([route]) => route === routes.panelFollowUpOptions),
    ).toBe(false)
  })
})
