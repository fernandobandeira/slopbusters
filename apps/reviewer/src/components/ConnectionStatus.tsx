import { UserRound } from 'lucide-react'
import type { AppStatus } from '../../shared/domain/types'
import '../connectionStatus.css'

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
    </div>
  )
}
