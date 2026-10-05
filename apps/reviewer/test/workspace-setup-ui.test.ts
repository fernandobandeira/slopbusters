// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceSetupPanel } from '../src/WorkspaceSetupPanel'
import { DiffSide, Provider } from '../shared/types'
import type { WorkspaceSetup } from '../shared/workspaceSetup'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows the exact plan and requires a separate approval click before execution', async () => {
  const job: WorkspaceSetup = {
    id: 'setup-fixture',
    pullId: 'pull-fixture',
    owner: 'example',
    repo: 'repository',
    sha: 'saved-sha',
    provider: Provider.claude,
    status: 'awaiting-approval',
    log: '',
    plan: {
      explanation: 'Use this repository’s documented setup.',
      commands: [
        {
          command: 'package-tool',
          args: ['install', '--locked'],
          directory: '.',
          reason: 'Install the pinned project dependencies.',
        },
      ],
    },
  }
  const requests: { path: string; options?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      requests.push({ path, options })
      const body =
        path === '/api/workspace-setups'
          ? []
          : path.endsWith('/approve')
            ? { ...job, status: 'ready', log: 'Setup finished' }
            : job
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  const view = render(
    createElement(WorkspaceSetupPanel, {
      pullId: job.pullId,
      sha: job.sha,
      side: DiffSide.right,
      path: 'source.ts',
      warnings: ['Missing dependency'],
    }),
  )
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(view.queryByText('Allow and run setup')).toBeNull()
  fireEvent.change(view.getByLabelText('Setup agent'), { target: { value: Provider.claude } })
  fireEvent.click(view.getByText('Ask for a setup plan'))
  await waitFor(() => expect(view.getByText('Allow and run setup')).toBeTruthy())
  expect(view.getByText('["package-tool","install","--locked"]')).toBeTruthy()
  expect(view.getByText(/Shared package-manager caches may be populated/)).toBeTruthy()
  expect(requests.some((request) => request.path.endsWith('/approve'))).toBe(false)
  expect(JSON.parse(requests[1].options!.body as string)).toMatchObject({
    provider: Provider.claude,
    path: 'source.ts',
  })
  fireEvent.click(view.getByText('Allow and run setup'))
  await waitFor(() =>
    expect(view.getByText(/Setup finished. Retry Go to definition./)).toBeTruthy(),
  )
  expect(
    JSON.parse(
      requests.find((request) => request.path.endsWith('/approve'))!.options!.body as string,
    ),
  ).toEqual({ side: DiffSide.right, approved: true })
  expect(view.queryByText('Allow and run setup')).toBeNull()
})
