import { useState } from 'react'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api'
import {
  availabilityLabels,
  DEFAULT_TEAMMATE_FINDINGS,
  skillAvailability,
  type Teammate,
} from '../../../shared/domain/teammates'
import { ReviewerFace } from '../../components/ReviewerFace'
import { call, message } from '../../lib/api'
import { reviewerFaceSrc } from '../../lib/reviewerFaces'
import { useApiQuery } from '../../lib/useApiQuery'
import { TeammateWizard } from './TeammateWizard'
import './teammates.css'

/** Settings section: the teammates, and the wizard that adds or edits one. */
export function TeammateSettings() {
  const query = useApiQuery(routes.listTeammates, {})
  const [wizard, setWizard] = useState<{ editing?: Teammate }>()
  const teammates = query.data?.teammates ?? []
  return (
    <section className="settings-section" aria-labelledby="teammates-title">
      <h2 id="teammates-title">Teammates</h2>
      <p className="muted">
        Reviewers built from skills you installed for Claude Code or Codex, such as a colleague’s
        review persona. Pick them with Uncle Bob and the Terminator when you ask the review panel
        about a PR.
      </p>
      {query.error && <p role="alert">{query.error}</p>}
      {!query.loading && !teammates.length && !query.error && (
        <p className="muted">No teammates yet.</p>
      )}
      <ul className="teammate-list">
        {teammates.map((teammate) => (
          <TeammateRow
            key={teammate.id}
            teammate={teammate}
            onEdit={() => {
              setWizard({ editing: teammate })
            }}
            onChanged={query.reload}
          />
        ))}
      </ul>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setWizard({})
        }}
      >
        Add teammate
      </Button>
      {wizard && (
        <TeammateWizard
          editing={wizard.editing}
          onClose={() => {
            setWizard(undefined)
          }}
          onDone={() => {
            setWizard(undefined)
            query.reload()
          }}
        />
      )}
    </section>
  )
}

function TeammateRow({
  teammate,
  onEdit,
  onChanged,
}: {
  teammate: Teammate
  onEdit: () => void
  onChanged: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const { error, remove, adoptDefaultCap } = useRowChanges(teammate, onChanged)
  const availability = skillAvailability(teammate.locations)
  return (
    <li className="teammate-row">
      <ReviewerFace
        name={teammate.name}
        src={reviewerFaceSrc(`teammate:${teammate.id}`, 'neutral', [teammate])}
        size={40}
      />
      <div className="teammate-row-text">
        <strong>{teammate.name}</strong>
        {teammate.title && <span className="muted">{teammate.title}</span>}
        <span className="muted">
          <code>{teammate.skill}</code> ·{' '}
          <span className={`teammate-availability teammate-availability-${availability}`}>
            {availabilityLabels[availability]}
          </span>
        </span>
        <FindingCap teammate={teammate} onAdoptDefault={() => void adoptDefaultCap()} />
        {availability === 'missing' && (
          <span role="status" className="teammate-skill-problem">
            The {teammate.skill} skill is no longer installed. Install it again, or edit this
            teammate to pick another skill.
          </span>
        )}
        {error && <span role="alert">{error}</span>}
      </div>
      <RowActions
        name={teammate.name}
        confirming={confirming}
        setConfirming={setConfirming}
        onEdit={onEdit}
        onRemove={() => void remove()}
      />
    </li>
  )
}

/** Remove a teammate, or move a cap saved before the new default up to it. */
function useRowChanges(teammate: Teammate, onChanged: () => void) {
  const [error, setError] = useState('')
  async function change(request: () => Promise<unknown>) {
    setError('')
    try {
      await request()
      onChanged()
    } catch (cause) {
      setError(message(cause))
    }
  }
  const { name, title, skill } = teammate
  return {
    error,
    remove: () => change(() => call(routes.removeTeammate, { params: { id: teammate.id } })),
    adoptDefaultCap: () =>
      change(() =>
        call(routes.updateTeammate, {
          params: { id: teammate.id },
          body: {
            name,
            skill,
            maxFindings: DEFAULT_TEAMMATE_FINDINGS,
            ...(title ? { title } : {}),
          },
        }),
      ),
  }
}

/** The teammate's cap, and a way to the new default when the saved one is lower. */
function FindingCap({
  teammate,
  onAdoptDefault,
}: {
  teammate: Teammate
  onAdoptDefault: () => void
}) {
  return (
    <span className="muted">
      Up to {teammate.maxFindings} findings per PR
      {teammate.maxFindings < DEFAULT_TEAMMATE_FINDINGS && (
        <>
          {' '}
          ·{' '}
          <Button size="xs" variant="link" onClick={onAdoptDefault}>
            Use new default ({DEFAULT_TEAMMATE_FINDINGS})
          </Button>
        </>
      )}
    </span>
  )
}

function RowActions({
  name,
  confirming,
  setConfirming,
  onEdit,
  onRemove,
}: {
  name: string
  confirming: boolean
  setConfirming: (confirming: boolean) => void
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="teammate-row-actions">
      {confirming ? (
        <>
          <Button size="xs" variant="destructive-outline" onClick={onRemove}>
            Remove {name}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setConfirming(false)
            }}
          >
            Keep
          </Button>
        </>
      ) : (
        <>
          <Button size="xs" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setConfirming(true)
            }}
          >
            Remove
          </Button>
        </>
      )}
    </div>
  )
}
