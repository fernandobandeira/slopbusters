import { createContext, useContext, useState, type ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api/panel'
import { leadSource } from '../../../shared/domain/grounding'
import type { FollowUpOptions } from '../../../shared/domain/panelFollowups'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { triage } from '../../../shared/domain/triage'
import { call, message } from '../../lib/api'
import { useApiQuery } from '../../lib/useApiQuery'
import { useLinearStatus } from '../../lib/useLinearStatus'

interface Filing {
  open: (entries: string[]) => void
  busy: boolean
}
const Followups = createContext<Filing | null>(null)

/** One connection check and filing dialog shared by the finding and summary actions. */
export function PanelFollowupProvider({
  sessionId,
  result,
  replace,
  children,
}: {
  sessionId: string
  result: PanelResult
  replace: (session: PanelSession) => void
  children: ReactNode
}) {
  const connected = useLinearStatus().data?.connected === true
  const [entries, setEntries] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [team, setTeam] = useState('')
  const choices = useApiQuery(
    routes.panelFollowUpOptions,
    {
      params: { id: sessionId },
      query: { url: result.pull.url },
    },
    { enabled: connected && entries.length > 0 },
  )
  async function file() {
    setBusy(true)
    setError('')
    try {
      const reply = await call(routes.filePanelFollowUps, {
        params: { id: sessionId },
        body: { url: result.pull.url, entries, ...(team ? { team } : {}) },
      })
      replace(reply.session)
      setEntries([])
      setError(
        reply.failures
          .map((failure) => {
            const entry = result.grounding?.resolved?.find((item) => item.id === failure.entry)
            const title =
              entry && leadSource(entry, result.grounding?.candidates ?? [])?.finding.title
            return `${title ?? failure.entry}: ${failure.message}`
          })
          .join(' '),
      )
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Followups value={connected ? { open: setEntries, busy } : null}>
      {children}
      {connected && entries.length > 0 && (
        <FollowupDialog
          entries={entries}
          result={result}
          choices={choices}
          team={team}
          setTeam={setTeam}
          busy={busy}
          file={() => void file()}
          cancel={() => {
            setEntries([])
          }}
        />
      )}
      {error && (
        <p className="linus-error" role="alert">
          {error}
        </p>
      )}
    </Followups>
  )
}

function FollowupDialog({
  entries,
  result,
  choices,
  team,
  setTeam,
  busy,
  file,
  cancel,
}: {
  entries: string[]
  result: PanelResult
  choices: { data?: FollowUpOptions; loading: boolean; error?: string }
  team: string
  setTeam: (team: string) => void
  busy: boolean
  file: () => void
  cancel: () => void
}) {
  return (
    <div className="linus-notice" role="dialog" aria-label="File follow-ups in Linear">
      <p>File these follow-ups in Linear, assigned to you?</p>
      <ul>
        {entries.map((id) => {
          const entry = result.grounding?.resolved?.find((item) => item.id === id)
          return (
            <li key={id}>
              {entry && leadSource(entry, result.grounding?.candidates ?? [])?.finding.title}
            </li>
          )
        })}
      </ul>
      {choices.data && <TeamChoice choices={choices.data} team={team} setTeam={setTeam} />}
      {choices.loading && <p role="status">Loading Linear teams…</p>}
      {choices.error && <p role="alert">{choices.error}</p>}
      <div className="linus-actions">
        <Button
          size="sm"
          disabled={busy || !choices.data || (!choices.data.linked && !team)}
          onClick={file}
        >
          Confirm follow-ups
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function TeamChoice({
  choices,
  team,
  setTeam,
}: {
  choices: FollowUpOptions
  team: string
  setTeam: (team: string) => void
}) {
  if (choices.linked)
    return (
      <p>
        Team: {choices.linked.team.name} ({choices.linked.team.key})
      </p>
    )
  return (
    <label>
      Team
      <select
        aria-label="Follow-up team"
        value={team}
        onChange={(event) => {
          setTeam(event.target.value)
        }}
      >
        <option value="">Choose a team</option>
        {choices.teams.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} ({item.key})
          </option>
        ))}
      </select>
    </label>
  )
}

export function FollowupAction({ result, id }: { result: PanelResult; id: string }) {
  const filing = useContext(Followups)
  const entry = result.grounding?.resolved?.find((item) => item.id === id)
  if (!entry || !triage(entry).followUp) return null
  const ticket = result.followUps?.find((item) => item.entry === id)
  if (ticket)
    return (
      <a href={ticket.url} target="_blank" rel="noreferrer">
        {ticket.identifier}
      </a>
    )
  if (!filing) return null
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={filing.busy}
      onClick={() => {
        filing.open([id])
      }}
    >
      File follow-up in Linear
    </Button>
  )
}

export function FollowupSummaryAction({ result }: { result: PanelResult }) {
  const filing = useContext(Followups)
  const entries = (result.grounding?.resolved ?? []).filter(
    (entry) =>
      triage(entry).followUp && !result.followUps?.some((ticket) => ticket.entry === entry.id),
  )
  if (!filing || !entries.length) return null
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={filing.busy}
      onClick={() => {
        filing.open(entries.map((entry) => entry.id))
      }}
    >
      {entries.length === 1 ? 'File 1 follow-up' : `File ${String(entries.length)} follow-ups`}
    </Button>
  )
}
