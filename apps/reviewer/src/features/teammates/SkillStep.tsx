import { RefreshCw } from 'lucide-react'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api'
import {
  skillAvailability,
  type InstalledSkill,
  type SkillAvailability,
} from '../../../shared/domain/teammates'
import { useApiQuery } from '../../lib/useApiQuery'

const groups: { availability: SkillAvailability; title: string; hint: string }[] = [
  {
    availability: 'both',
    title: 'Claude and Codex',
    hint: 'Ready whichever provider your primary model uses.',
  },
  {
    availability: 'claude',
    title: 'Claude only',
    hint: 'Reviews only while Claude is your primary model. Install it in ~/.codex/skills too to use it with Codex.',
  },
  {
    availability: 'codex',
    title: 'Codex only',
    hint: 'Reviews only while Codex is your primary model. Install it in ~/.claude/skills too to use it with Claude.',
  },
]

/** Step one: pick the installed skill the teammate reviews with. */
export function SkillStep({
  selected,
  teammateId,
  onSelect,
}: {
  selected?: string
  /** The teammate being edited, whose own skill stays selectable. */
  teammateId?: string
  onSelect: (skill: string) => void
}) {
  const query = useApiQuery(routes.listInstalledSkills, {})
  const skills = query.data?.skills ?? []
  return (
    <div className="teammate-step">
      <p className="muted">
        A teammate reviews with a skill you installed for Claude Code or Codex. Its instructions are
        sent to your model provider with the PR, and it can read the PR’s checkout, so add only
        skills you trust as much as the built-in reviewers.
      </p>
      <div className="teammate-skill-toolbar">
        <span className="muted">
          {query.loading ? 'Looking for skills…' : `${String(skills.length)} skills installed`}
        </span>
        <Button size="xs" variant="ghost" disabled={query.loading} onClick={query.reload}>
          <RefreshCw size={12} aria-hidden="true" />
          Rescan
        </Button>
      </div>
      {query.error && <p role="alert">{query.error}</p>}
      {!query.loading && !skills.length && !query.error && (
        <p className="muted">
          No skills found in ~/.claude/skills or ~/.codex/skills. Install one there, then rescan.
        </p>
      )}
      <div role="radiogroup" aria-label="Installed skills" className="teammate-skill-groups">
        {groups.map((group) => (
          <SkillGroup
            key={group.availability}
            {...group}
            skills={skills.filter(
              (skill) => skillAvailability(skill.locations) === group.availability,
            )}
            selected={selected}
            teammateId={teammateId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

function SkillGroup({
  title,
  hint,
  skills,
  selected,
  teammateId,
  onSelect,
}: {
  title: string
  hint: string
  skills: InstalledSkill[]
  selected?: string
  teammateId?: string
  onSelect: (skill: string) => void
}) {
  if (!skills.length) return null
  return (
    <section className="teammate-skill-group">
      <h3>{title}</h3>
      <p className="muted">{hint}</p>
      {skills.map((skill) => {
        const reason =
          skill.problem ??
          (skill.takenBy && skill.takenBy !== teammateId ? 'Another teammate uses this skill.' : '')
        return (
          <button
            key={skill.name}
            type="button"
            role="radio"
            aria-checked={selected === skill.name}
            className="teammate-skill"
            disabled={Boolean(reason)}
            onClick={() => {
              onSelect(skill.name)
            }}
          >
            <strong>{skill.name}</strong>
            {skill.description && (
              <span className="teammate-skill-description">{skill.description}</span>
            )}
            {reason && <span className="teammate-skill-problem">{reason}</span>}
          </button>
        )
      })}
    </section>
  )
}
