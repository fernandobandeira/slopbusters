<p align="center">
  <img src="assets/slopbusters.png" alt="Slopbusters" width="420">
</p>

<p align="center"><em>Who you gonna prompt?</em></p>

A crew of [opencode](https://opencode.ai) agents that push back on the first idea, demand evidence, and keep AI slop out of your briefs, designs, and code.

## The crew

| Agent | Role |
|-------|------|
| **Ana** · `analyst` | Research, brainstorming, and strategy. Challenges assumptions and grounds briefs in evidence. |
| **Archie** · `architect` | System design and ADRs. Calls out over- and under-engineering. |
| **Ulysses** · `ux` | User research, personas, journeys, and frontend specs. |
| **Paul** · `pm` | Turns analyst, architect, and UX findings into PRDs, roadmaps, and epics. |
| **Dev** · `dev` | Implements tasks autonomously with TDD and ADR compliance. |
| **SM** · `sm-reviewer` | Verifies acceptance criteria. Focused on "done", not "perfect". |
| **Rita** · `recruiter` | Creates new agents, skills, and subagents. |

Press **Tab** in opencode to cycle between orchestrators.

## What's inside

- `.opencode/agents/`: agent personas and subagents (`competitive-analyzer`, `knowledge-harvester`)
- `.opencode/skills/`: thinking toolkits (`devils-advocate`, `root-cause`, `ideation`, `role-playing`, `strategic-analysis`, `user-research`, `teacher`) plus `go-best-practices` and `react-best-practices`
- `templates/`: document templates per role (ADRs, RFCs, PRDs, personas, pitch decks, and more), plus an `AGENTS.md` to drop into your project

## Setup

1. Copy `.opencode/` into your project, or into your global opencode config.
2. Copy `templates/AGENTS.md` to your project root and follow the setup notes at the top of the file. They cover Basic Memory and the templates path.
