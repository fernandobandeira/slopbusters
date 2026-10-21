import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { MAX_TEAMMATE_FINDINGS, type Teammate } from '../../../shared/domain/teammates'
import { FacesStep } from './FacesStep'
import { SkillStep } from './SkillStep'
import { useTeammateWizard, wizardSteps, type WizardDraft } from './useTeammateWizard'

/** Add a teammate, or edit one, in three steps: skill, name, faces. */
export function TeammateWizard({
  editing,
  onClose,
  onDone,
}: {
  editing?: Teammate
  onClose: () => void
  onDone: (teammate: Teammate) => void
}) {
  const wizard = useTeammateWizard(editing, onDone)
  const { step, draft } = wizard
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPopup className="teammate-wizard">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add a teammate'}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {wizardSteps.length}: {wizardSteps[step]}
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          {step === 0 && (
            <SkillStep
              selected={draft.skill}
              teammateId={wizard.saved?.id}
              onSelect={(skill) => {
                wizard.update({ skill, ...(draft.name ? {} : { name: suggestedName(skill) }) })
              }}
            />
          )}
          {step === 1 && <DetailsStep draft={draft} update={wizard.update} />}
          {step === 2 && (
            <FacesStep
              name={draft.name}
              saved={wizard.saved}
              faces={draft.faces}
              setFace={wizard.setFace}
            />
          )}
          {wizard.error && (
            <p role="alert" className="error-text">
              {wizard.error}
            </p>
          )}
          <WizardActions wizard={wizard} editing={Boolean(editing)} />
        </div>
      </DialogPopup>
    </Dialog>
  )
}

function WizardActions({
  wizard,
  editing,
}: {
  wizard: ReturnType<typeof useTeammateWizard>
  editing: boolean
}) {
  const { step, setStep, ready, saving } = wizard
  return (
    <div className="dialog-actions">
      {step > 0 && (
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setStep(step - 1)
          }}
        >
          Back
        </Button>
      )}
      {step === wizardSteps.length - 1 ? (
        <Button disabled={saving || !ready.every(Boolean)} onClick={() => void wizard.finish()}>
          {saving && <LoaderCircle size={13} className="animate-spin" />}
          {editing ? 'Save teammate' : 'Add teammate'}
        </Button>
      ) : (
        <Button
          disabled={!ready[step]}
          onClick={() => {
            setStep(step + 1)
          }}
        >
          Next
        </Button>
      )}
    </div>
  )
}

/** Step two: what the teammate is called and how many findings it may report. */
function DetailsStep({
  draft,
  update,
}: {
  draft: WizardDraft
  update: (changes: Partial<WizardDraft>) => void
}) {
  return (
    <div className="teammate-step teammate-details">
      <label>
        <span>Name</span>
        <Input
          autoFocus
          maxLength={60}
          value={draft.name}
          placeholder="Avery"
          onChange={(event) => {
            update({ name: event.target.value })
          }}
        />
      </label>
      <label>
        <span>Title</span>
        <Input
          maxLength={80}
          value={draft.title}
          placeholder="Backend lead"
          onChange={(event) => {
            update({ title: event.target.value })
          }}
        />
        <span className="muted">Tells the judge what this reviewer is good at.</span>
      </label>
      <label>
        <span>GitHub username</span>
        <Input
          maxLength={40}
          value={draft.login}
          placeholder="avery"
          onChange={(event) => {
            update({ login: event.target.value })
          }}
        />
        <span className="muted">
          Optional. Lets this reviewer see the comments they already left on a PR.
        </span>
      </label>
      <label>
        <span>Most findings per PR</span>
        <Input
          type="number"
          min={1}
          max={MAX_TEAMMATE_FINDINGS}
          value={draft.maxFindings}
          onChange={(event) => {
            const value = Math.round(Number(event.target.value))
            if (Number.isFinite(value))
              update({ maxFindings: Math.min(MAX_TEAMMATE_FINDINGS, Math.max(1, value)) })
          }}
        />
      </label>
    </div>
  )
}

/** `AveryReview` suggests `Avery`; the user can change it. */
function suggestedName(skill: string): string {
  const base = skill
    .replace(/[-_.]?review(er)?$/i, '')
    .replace(/[-_.]+/g, ' ')
    .trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : skill
}
