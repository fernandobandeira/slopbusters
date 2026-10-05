import { UserRound } from 'lucide-react'
import type { AppStatus, ToolStatus } from '../../shared/domain/types'
import { OpenAI, ClaudeAI } from '~/components/ProviderLogos'
import '../connectionStatus.css'

function providerState(status: ToolStatus | undefined) {
  if (!status) return { label: 'Checking', state: 'checking' }
  if (!status.available) return { label: 'Not installed', state: 'unavailable' }
  if (status.authenticated === true) return { label: 'Signed in', state: 'authenticated' }
  if (status.authenticated === false) return { label: 'Sign in needed', state: 'signed-out' }
  return { label: 'Installed · sign-in status unavailable', state: 'installed' }
}

function ProviderConnection({
  name,
  status,
  Logo,
}: {
  name: string
  status: ToolStatus | undefined
  Logo: typeof OpenAI
}) {
  const { label, state } = providerState(status)
  const title = `${name}: ${label}${status ? `. ${status.detail}` : ''}`
  return (
    <span
      className="provider-connection"
      data-state={state}
      role="img"
      aria-label={`${name}: ${label}`}
      title={title}
    >
      <Logo width={16} height={16} aria-hidden="true" />
      <span className="provider-connection-name">{name}</span>
    </span>
  )
}

export function ConnectionStatus({ status }: { status?: AppStatus }) {
  const profile = status?.github.profile
  const connected = status?.github.available === true
  const login = profile?.login ?? (connected ? status?.github.detail : undefined)
  const avatar = profile?.avatarUrl.startsWith('https://avatars.githubusercontent.com/')
    ? profile.avatarUrl
    : undefined
  const url = profile?.url.startsWith('https://github.com/') ? profile.url : undefined
  const account = (
    <>
      {avatar ? (
        <img className="connection-avatar" src={avatar} alt="" width={26} height={26} />
      ) : (
        <span className="connection-avatar connection-avatar-placeholder">
          <UserRound size={17} aria-hidden="true" />
        </span>
      )}
      <span className="connection-account-name">
        {login ?? (status ? 'GitHub not connected' : 'Connecting…')}
      </span>
    </>
  )
  return (
    <div className="connection-status">
      {url ? (
        <a
          className="connection-account"
          href={url}
          target="_blank"
          rel="noreferrer"
          title={`GitHub · ${login}`}
        >
          {account}
        </a>
      ) : (
        <div className="connection-account" title={status?.github.detail}>
          {account}
        </div>
      )}
      <div className="connection-providers" aria-label="Coding providers">
        <ProviderConnection name="Codex" status={status?.codex} Logo={OpenAI} />
        <ProviderConnection name="Claude" status={status?.claude} Logo={ClaudeAI} />
      </div>
    </div>
  )
}
