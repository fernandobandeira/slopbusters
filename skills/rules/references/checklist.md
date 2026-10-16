# Where rules hide

Use this as a search list, not a form. Report only violations you can cite.

## Written down

- [ ] `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` at the root and in every directory on the path to each changed file.
- [ ] `CONTRIBUTING.md`, `docs/` pages named like conventions, architecture, style, or decisions (ADRs).
- [ ] Agent rule folders: `.cursor/rules/`, `.github/copilot-instructions.md`, `.github/instructions/`.
- [ ] PR templates and issue templates: required sections, checklists, linked tickets.
- [ ] Package scripts and CI workflows: steps the rules say must pass before merge, such as a migration check or a generated file that must be committed.

## Enforced by tools

- [ ] Lint, formatter, and type-checker config. Look for rules the diff disables inline, files it adds to an ignore list, and baselines, suppressions, or allowlists that grew.
- [ ] Dependency and architecture rules: layers that may not import each other, modules that must stay pure, packages that need approval.
- [ ] Test config: required test locations, naming, and coverage thresholds.

## Followed without being written

- [ ] Where this kind of file lives: find the siblings of every new file.
- [ ] How this layer is called: services return results, handlers validate input, adapters own I/O.
- [ ] Which helper wraps a common call: logging, errors, HTTP, database transactions, feature flags.
- [ ] How the codebase names this kind of thing: suffixes, prefixes, plural folders.

A convention needs at least three existing places that follow it and none that break it. Cite two.

## Not your job

- Readability, naming you would merely prefer, function size, design patterns, duplication: the clean-code reviewer.
- Bugs the rules are silent about: the correctness reviewer.
- Formatting a formatter fixes automatically.
