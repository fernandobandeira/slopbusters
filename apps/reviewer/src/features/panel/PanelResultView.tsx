import { useState } from 'react'
import { Button } from '~/components/ui/button'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import type { Teammate } from '../../../shared/domain/teammates'
import { PanelGate } from './PanelGate'
import { PanelTour, type PanelDraftContext } from './PanelTour'
import type { usePanelTour } from './usePanelTour'

/** A reviewed PR: its grounded findings one by one, or the fixes the author chooses from them. */
export function PanelResultView({
  session,
  result,
  tour,
  teammates,
  context,
  replace,
  onOpen,
}: {
  session: PanelSession
  result: PanelResult
  tour: ReturnType<typeof usePanelTour>
  teammates?: Teammate[]
  context: PanelDraftContext
  replace: (session: PanelSession) => void
  onOpen: (sessionId: string) => void
}) {
  const [choosing, setChoosing] = useState(false)
  const gated = Boolean(result.grounding?.resolved?.length)
  return (
    <>
      {gated && (
        <Button
          size="sm"
          variant={choosing ? 'default' : 'outline'}
          aria-pressed={choosing}
          onClick={() => {
            setChoosing(!choosing)
          }}
        >
          {choosing ? 'Back to the findings' : 'Choose fixes'}
        </Button>
      )}
      {gated && choosing ? (
        <PanelGate
          session={session}
          result={result}
          replace={replace}
          onOpen={onOpen}
          moved={
            context.pull.headSha !== result.pull.headSha ||
            context.pull.baseSha !== result.pull.baseSha
          }
        />
      ) : (
        <PanelTour
          result={result}
          reviewers={session.reviewers}
          teammates={teammates}
          index={tour.index}
          advance={tour.advance}
          context={context}
        />
      )}
    </>
  )
}
