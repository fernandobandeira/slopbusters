import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AppStatus } from '../shared/types'
import { ConnectionStatus } from '../src/ConnectionStatus'

describe('sidebar connection status', () => {
  it('shows a real account profile and keeps installed providers distinct from signed-in providers', () => {
    const status: AppStatus = {
      github: {
        available: true,
        detail: 'reviewer',
        profile: {
          login: 'reviewer',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1',
          url: 'https://github.com/reviewer',
        },
      },
      codex: { available: true, authenticated: true, detail: 'codex 1.0.0' },
      claude: { available: true, detail: 'claude 1.0.0' },
    }

    const markup = renderToStaticMarkup(createElement(ConnectionStatus, { status }))

    expect(markup).toContain('src="https://avatars.githubusercontent.com/u/1"')
    expect(markup).toContain('href="https://github.com/reviewer"')
    expect(markup).toContain('aria-label="Codex: Signed in"')
    expect(markup).toContain('aria-label="Claude: Installed · sign-in status unavailable"')
    expect(markup).not.toContain('Claude: Signed in')
  })
})
