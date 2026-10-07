// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopBridge, UpdateState } from '../shared/desktop'
import { UpdateButton } from '../src/components/UpdateButton'

afterEach(() => {
  cleanup()
  delete window.reviewerDesktop
})

function installBridge(initial: UpdateState) {
  let publish: (state: UpdateState) => void = () => undefined
  let finishCheck: () => void = () => undefined
  const bridge = {
    platform: 'darwin',
    getUpdateState: vi.fn(() => Promise.resolve(initial)),
    onUpdateState: vi.fn((listener: (state: UpdateState) => void) => {
      publish = listener
      return () => undefined
    }),
    checkForUpdates: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCheck = resolve
        }),
    ),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    installUpdate: vi.fn(() => Promise.resolve()),
  } satisfies DesktopBridge
  window.reviewerDesktop = bridge
  return {
    bridge,
    publish: (state: UpdateState) => {
      publish(state)
    },
    finishCheck: () => {
      finishCheck()
    },
  }
}

it('shows a requested update check until it fails again, keeping the reason available', async () => {
  const { bridge, publish, finishCheck } = installBridge({
    status: 'error',
    message: 'Cannot find latest-mac.yml',
  })
  render(<UpdateButton />)
  const retry = await screen.findByRole('button', { name: 'Update check failed · Retry' })
  expect(retry.title).toBe('Cannot find latest-mac.yml')

  fireEvent.click(retry)
  act(() => {
    publish({ status: 'checking' })
  })
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Checking for updates…' }).disabled,
  ).toBe(true)
  expect(bridge.checkForUpdates).toHaveBeenCalledOnce()

  act(() => {
    publish({ status: 'error', message: 'getaddrinfo ENOTFOUND github.com' })
  })
  await act(async () => {
    finishCheck()
    await Promise.resolve()
  })
  expect(screen.getByRole('button', { name: 'Update check failed · Retry' }).title).toBe(
    'getaddrinfo ENOTFOUND github.com',
  )
})

it('keeps background checks silent', async () => {
  const { publish } = installBridge({ status: 'idle' })
  render(<UpdateButton />)
  await act(async () => {
    await Promise.resolve()
  })
  act(() => {
    publish({ status: 'checking' })
  })
  expect(screen.queryByRole('button')).toBeNull()
})
