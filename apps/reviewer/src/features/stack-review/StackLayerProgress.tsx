import { useEffect, useRef, useState } from 'react'
import { getPanel } from '../../../shared/api'
import type { PanelReviewer } from '../../../shared/domain/panel'
import { panelSeatOutcomeLabel, type PanelSession } from '../../../shared/domain/panelSession'
import { providerLabel } from '../../../shared/domain/preferences'
import {
  layerProgress,
  type StackLayer,
  type StackReviewSession,
} from '../../../shared/domain/stackReview'
import { call } from '../../lib/api'

export function StackLayerProgress({ session }: { session: StackReviewSession }) {
  const panels = useLayerPanels(session)
  const seats = new Set(
    session.layers.flatMap(({ panel: id }) => {
      const panel = id ? panels[id] : undefined
      return panel?.reviewers.map((seat) => seatName(panel, seat)) ?? []
    }),
  )
  return (
    <>
      {seats.size > 0 && (
        <p className="stack-brief-detail">Panel seats · {[...seats].join(', ')}</p>
      )}
      <ol className="stack-review-layers" aria-label="Layers, bottom to top">
        {session.layers.map((layer) => (
          <li key={layer.url} className={`stack-review-layer stack-review-${layer.state}`}>
            <span className="stack-pr-number">#{layer.number}</span> {layer.title}
            <span className="stack-brief-detail">
              {panelProgress(layer, layer.panel ? panels[layer.panel] : undefined)}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

function panelProgress(layer: StackLayer, panel?: PanelSession) {
  if (layer.state !== 'reviewing' || !panel || layer.note) return layerProgress(layer)
  const pending = panel.pending
  if (pending && pending.pull.url !== layer.url) return 'Waiting for its turn in the panel.'
  const outcomes = panel.reviewers.flatMap((seat) => {
    const review = pending?.reviews.find((item) => item.reviewer === seat.id)
    return review ? [`${seatName(panel, seat)} · ${panelSeatOutcomeLabel(review)}`] : []
  })
  if (outcomes.length)
    return `${String(outcomes.length)} of ${String(panel.reviewers.length)} reviewers finished · ${outcomes.join(', ')}`
  return panel.progress.replace(new RegExp(` (?:on )?PR #${String(layer.number)}\\b`), '')
}

function seatName(panel: PanelSession, seat: PanelReviewer) {
  const provider = seat.model?.provider ?? panel.model.provider
  return seat.id.endsWith(`@${provider}`) ? seat.name : `${seat.name} (${providerLabel(provider)})`
}

/** Refresh working panels with the stack poll, keeping the last details until the next revision. */
function useLayerPanels(session: StackReviewSession) {
  const [panels, setPanels] = useState<Record<string, PanelSession>>({})
  const revisions = useRef(new Map<string, number>())
  useEffect(() => {
    const controller = new AbortController()
    const ids = new Set(
      session.layers.flatMap((layer) =>
        layer.state === 'reviewing' && layer.panel ? [layer.panel] : [],
      ),
    )
    for (const id of ids) {
      void call(
        getPanel,
        { params: { id }, query: { after: revisions.current.get(id) } },
        { signal: controller.signal },
      )
        .then(({ revision, session: panel }) => {
          if (controller.signal.aborted || !panel) return
          revisions.current.set(id, revision)
          setPanels((previous) => ({ ...previous, [id]: panel }))
        })
        .catch(() => {
          // Keep the last visible progress and try again at the next stack poll.
        })
    }
    return () => {
      controller.abort()
    }
  }, [session])
  return panels
}
