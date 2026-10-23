// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import type { ApiContract } from '../shared/api/contract'
import type { InstalledSkill, Teammate } from '../shared/domain/teammates'
import { Provider } from '../shared/domain/types'
import { PanelPicker } from '../src/features/panel/PanelPicker'
import { savedPanelSelection } from '../src/features/panel/panelSelection'
import { TeammateSettings } from '../src/features/teammates/TeammateSettings'
import { call } from '../src/lib/api'

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  call: vi.fn(),
}))
vi.mock('../src/features/teammates/avatarImage', () => ({
  ACCEPTED_AVATAR_TYPES: 'image/png',
  avatarFromFile: vi.fn(() =>
    Promise.resolve({ png: 'iVBORw0KGgo=', preview: 'data:image/png;base64,iVBORw0KGgo=' }),
  ),
}))

const skills: InstalledSkill[] = [
  {
    name: 'AveryReview',
    description: 'Review as Avery.',
    locations: { claude: '/c/AveryReview', codex: '/x/AveryReview' },
  },
  { name: 'RileyReview', description: 'Review as Riley.', locations: { claude: '/c/RileyReview' } },
  {
    name: 'MorganReview',
    description: 'Review as Morgan.',
    locations: { codex: '/x/MorganReview' },
    takenBy: 'morgan',
  },
]
function teammate(changes: Partial<Teammate> = {}): Teammate {
  return {
    id: 'avery',
    name: 'Avery',
    skill: 'AveryReview',
    maxFindings: 10,
    updatedAt: '1',
    locations: { claude: '/c/AveryReview', codex: '/x/AveryReview' },
    avatars: [],
    ...changes,
  }
}
let teammates: Teammate[] = []

beforeEach(() => {
  teammates = []
  localStorage.clear()
  vi.mocked(call).mockImplementation((route: ApiContract, input) => {
    if (route === routes.listTeammates) return Promise.resolve({ teammates })
    if (route === routes.listInstalledSkills) return Promise.resolve({ skills })
    if (route === routes.createTeammate) return Promise.resolve(teammate())
    if (route === routes.saveTeammateAvatar) {
      const mood = (input as { params: { mood: 'happy' } }).params.mood
      return Promise.resolve(teammate({ avatars: [mood] }))
    }
    if (route === routes.startPanel) return Promise.resolve({ id: 'panel-1' })
    return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the teammate wizard', () => {
  it('creates a teammate from an installed skill with a suggested name and one face', async () => {
    render(
      <MemoryRouter>
        <TeammateSettings />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Add teammate' }))

    const avery = await screen.findByRole('radio', { name: /AveryReview/ })
    expect(screen.getByText('Claude only')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /MorganReview/ }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(avery)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Avery')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(screen.getByLabelText('Choose the happy face'), {
      target: { files: [new File(['x'], 'avery.png', { type: 'image/png' })] },
    })
    await screen.findByRole('button', { name: 'Remove the happy face' })
    fireEvent.click(screen.getByRole('button', { name: 'Add teammate' }))

    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(routes.saveTeammateAvatar, {
        params: { id: 'avery', mood: 'happy' },
        body: { png: 'iVBORw0KGgo=' },
      })
    })
    expect(call).toHaveBeenCalledWith(routes.createTeammate, {
      body: { name: 'Avery', skill: 'AveryReview', maxFindings: 40 },
    })
  })

  it('keeps a saved cap and offers the new default without changing it silently', async () => {
    teammates = [teammate({ title: 'Backend lead' })]
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.listTeammates) return Promise.resolve({ teammates })
      if (route === routes.updateTeammate) return Promise.resolve(teammate({ maxFindings: 40 }))
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    render(
      <MemoryRouter>
        <TeammateSettings />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Up to 10 findings per PR/)).toBeTruthy()
    expect(call).not.toHaveBeenCalledWith(routes.updateTeammate, expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Use new default (40)' }))

    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(routes.updateTeammate, {
        params: { id: 'avery' },
        body: {
          name: 'Avery',
          skill: 'AveryReview',
          maxFindings: 40,
          title: 'Backend lead',
        },
      })
    })
  })

  it('says when a teammate’s skill is no longer installed', async () => {
    teammates = [teammate({ locations: {} })]

    render(
      <MemoryRouter>
        <TeammateSettings />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/The AveryReview skill is no longer installed/)).toBeTruthy()
  })
})

describe('asking the panel', () => {
  function openPicker(onOpen = vi.fn()) {
    render(
      <MemoryRouter>
        <PanelPicker
          repository="review-room/example"
          pull={{ url: 'https://github.com/review-room/example/pull/128', number: 128 }}
          provider={Provider.codex}
          onOpen={onOpen}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Ask the review panel/ }))
    return onOpen
  }

  it('runs a teammate on every installed provider and anyone else on the primary’s', async () => {
    teammates = [
      teammate(),
      teammate({ id: 'riley', name: 'Riley', skill: 'RileyReview', locations: { claude: '/c' } }),
    ]
    const onOpen = openPicker()

    fireEvent.click(await screen.findByRole('checkbox', { name: /Riley/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Avery/ }))
    expect(screen.getByRole('button', { name: 'Riley on Codex' }).hasAttribute('disabled')).toBe(
      true,
    )
    expect(
      screen.getByRole('button', { name: 'Riley on Claude' }).getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Uncle Bob on Claude' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review with 4 reviewers, 6 runs' }))

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith('panel-1')
    })
    expect(call).toHaveBeenCalledWith(routes.startPanel, {
      body: {
        repository: 'review-room/example',
        urls: ['https://github.com/review-room/example/pull/128'],
        reviewers: [
          { id: 'unclebob', providers: [Provider.codex, Provider.claude] },
          { id: 'terminator', providers: [Provider.codex] },
          { id: 'teammate:riley', providers: [Provider.claude] },
          { id: 'teammate:avery', providers: [Provider.codex, Provider.claude] },
        ],
      },
    })
  })

  it('takes a reviewer off when its last provider is turned off', async () => {
    openPicker()

    fireEvent.click(await screen.findByRole('button', { name: 'Terminator on Codex' }))

    expect(screen.getByRole('checkbox', { name: /Terminator/ }).getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(screen.getByRole('button', { name: 'Review with 1 reviewer' })).toBeTruthy()
  })
})

describe('a panel that is already running', () => {
  it('opens the running panel and says why when another cannot start', async () => {
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
      if (route === routes.startPanel)
        return Promise.reject(new Error('Finish or cancel the current panel review of PR #131.'))
      if (route === routes.latestPanel)
        return Promise.resolve({ session: { id: 'running-panel', status: 'running' } })
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    const onOpen = vi.fn()
    render(
      <MemoryRouter>
        <PanelPicker
          repository="review-room/example"
          pull={{ url: 'https://github.com/review-room/example/pull/128', number: 128 }}
          provider={Provider.codex}
          onOpen={onOpen}
          openOnMount
        />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Review with 2 reviewers' }))

    expect(await screen.findByText(/Finish or cancel the current panel review/)).toBeTruthy()
    expect(onOpen).toHaveBeenCalledWith('running-panel')
  })

  it('reads picks saved before the Terminator was renamed', () => {
    localStorage.setItem('slopbusters:panel-reviewers', JSON.stringify(['unclebob', 'rules']))

    expect(savedPanelSelection()).toEqual([{ id: 'unclebob' }, { id: 'terminator' }])
  })
})
