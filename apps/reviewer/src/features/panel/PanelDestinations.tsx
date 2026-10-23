import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { groundingOriginLabels, leadSource } from '../../../shared/domain/grounding'
import type { GateItem } from '../../../shared/domain/panelGate'
import type { MetadataDraft } from '../../../shared/domain/panelFix'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { CopyButton } from '../../components/CopyButton'
import { usePanelRoutes } from './usePanelRoutes'

type Routes = ReturnType<typeof usePanelRoutes>
const fields = ['title', 'description'] as const

/**
 * Where the rest of the ready work goes: another layer's round, a drafted title or description,
 * and problems that were there before this PR, copied as follow-ups to file.
 */
export function PanelDestinations({
  session,
  result,
  ready,
  replace,
  onOpen,
}: {
  session: PanelSession
  result: PanelResult
  ready: readonly GateItem[]
  replace: (session: PanelSession) => void
  onOpen: (sessionId: string) => void
}) {
  const routes = usePanelRoutes(session, result, replace)
  const layers = [
    ...new Set(ready.flatMap((item) => (item.route?.kind === 'layer' ? [item.route.pull] : []))),
  ]
  const metadata = (field: (typeof fields)[number]) =>
    ready.filter(
      (item) =>
        item.route?.kind === 'metadata' &&
        item.route.field === field &&
        item.route.pull === result.pull.number,
    ).length
  return (
    <div className="panel-destinations">
      {layers.map((pull) => (
        <LayerRoute
          key={pull}
          pull={pull}
          count={
            ready.filter((item) => item.route?.kind === 'layer' && item.route.pull === pull).length
          }
          routed={result.routed?.find((route) => route.pull === pull)?.session}
          routes={routes}
          onOpen={onOpen}
        />
      ))}
      {fields.map(
        (field) =>
          metadata(field) > 0 && (
            <MetadataRoute
              key={field}
              field={field}
              count={metadata(field)}
              draft={result.metadataDrafts?.find((item) => item.field === field)}
              routes={routes}
            />
          ),
      )}
      <FollowUps result={result} />
      {routes.error && <p role="alert">{routes.error}</p>}
    </div>
  )
}

function LayerRoute(props: {
  pull: number
  count: number
  routed?: string
  routes: Routes
  onOpen: (sessionId: string) => void
}) {
  const { pull, count, routed, routes } = props
  const label = `PR #${String(pull)}`
  if (routed)
    return (
      <p className="muted">
        {count} {count === 1 ? 'finding was' : 'findings were'} sent to a round on {label}, which
        grounds {count === 1 ? 'it' : 'them'} against that layer.{' '}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            props.onOpen(routed)
          }}
        >
          Open {label}’s round
        </Button>
      </p>
    )
  const busy = routes.busy === `layer:${String(pull)}`
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={Boolean(routes.busy)}
      onClick={() => {
        routes.toLayer(pull)
      }}
    >
      {busy && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
      Ground {count} {count === 1 ? 'finding' : 'findings'} on {label} with the same panel
    </Button>
  )
}

function MetadataRoute(props: {
  field: 'title' | 'description'
  count: number
  draft?: MetadataDraft
  routes: Routes
}) {
  const { field, draft, routes } = props
  const busy = routes.busy === field
  return (
    <div className="panel-gate-field">
      {draft && <DraftText key={draft.createdAt} field={field} draft={draft} />}
      <Button
        size="sm"
        variant="outline"
        disabled={Boolean(routes.busy)}
        onClick={() => {
          routes.draft(field)
        }}
      >
        {busy && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
        {draft ? `Draft the ${field} again` : `Draft the new ${field} (${String(props.count)})`}
      </Button>
    </div>
  )
}

/** An editable draft; copying it is how it leaves the app, since nothing here publishes it. */
function DraftText({ field, draft }: { field: string; draft: MetadataDraft }) {
  const [text, setText] = useState(draft.text)
  return (
    <label className="panel-gate-field">
      <span>New {field} · a draft, not published</span>
      <textarea
        rows={field === 'title' ? 2 : 8}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
      <CopyButton label={`Copy the ${field}`} text={text} />
    </label>
  )
}

/** Problems that were there before this PR, whatever the author chose, as a list to file. */
function FollowUps({ result }: { result: PanelResult }) {
  const candidates = result.grounding?.candidates ?? []
  const entries = (result.grounding?.resolved ?? []).filter(
    (entry) =>
      entry.origin === 'preexisting' && ['legit', 'authorsCall'].includes(entry.verdict ?? ''),
  )
  if (!entries.length) return null
  const markdown = [
    `Follow-ups found while reviewing ${result.pull.url}:`,
    '',
    ...entries.map((entry) => {
      const title = leadSource(entry, candidates)?.finding.title ?? entry.id
      const evidence = entry.evidence.length ? ` (${entry.evidence.join(', ')})` : ''
      return `- **${title}**: ${entry.reason}${evidence}`
    }),
  ].join('\n')
  return (
    <p className="muted">
      {entries.length} {groundingOriginLabels.preexisting.toLowerCase()}{' '}
      <CopyButton label="Copy the follow-ups" text={markdown} />
    </p>
  )
}
