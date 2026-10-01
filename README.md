<p align="center">
  <img src="assets/slopbusters.png" alt="Slopbusters" width="420">
</p>

<p align="center"><em>Who you gonna prompt?</em></p>

A library of agent skills that keep AI slop out of your plans, designs, and code. Skills follow the open [Agent Skills](https://agentskills.io/specification) format, so the same skills work in Claude Code, Codex, Cursor, Gemini CLI, opencode, and any other compatible agent.

## Install

**Claude Code**

```
/plugin marketplace add fernandobandeira/slopbusters
/plugin install slopbusters@slopbusters
```

**Codex**

```
codex plugin marketplace add fernandobandeira/slopbusters
codex plugin add slopbusters@slopbusters
```

**Gemini CLI**

```
gemini extensions install https://github.com/fernandobandeira/slopbusters
```

**Cursor, opencode, Copilot, and everything else**

```
npx skills add fernandobandeira/slopbusters
```

or, with the GitHub CLI:

```
gh skill install fernandobandeira/slopbusters
```

Both detect which agents you have installed and copy the skills into the right place.

## Skills

| Skill | What it does |
|-------|--------------|
| [`unclebob`](skills/unclebob/SKILL.md) | Clean-code review in the voice of Uncle Bob. Reviews a branch, uncommitted changes, or a PR for readability, reusability, low cognitive load, and layered "stepdown" structure where high-level functions state the business rule. Also checks Arrange-Act-Assert tests. |

## Repo layout

```
skills/<name>/SKILL.md        # every skill lives here; all agents share it
.claude-plugin/               # Claude Code plugin + marketplace
.codex-plugin/                # Codex plugin
.agents/plugins/              # Codex marketplace
.cursor-plugin/               # Cursor plugin
gemini-extension.json         # Gemini CLI extension
archive/                      # the original opencode agents and templates, kept for reference
```

## Writing a skill

1. Create `skills/<name>/SKILL.md`. The `name` must match the folder: lowercase letters, numbers, and hyphens only.
2. Add frontmatter with `name` and `description`. Agents read the description to decide when to use the skill, so say what it does *and* when to use it.
3. Describe actions, not tool names ("search the codebase", not "use the Grep tool"), so the skill works in every agent.
4. Put supporting files (scripts, references, examples) next to `SKILL.md`.

```markdown
---
name: example-skill
description: What this skill does. Use when the user asks for X or mentions Y.
---

# Example Skill

Instructions for the agent...
```
