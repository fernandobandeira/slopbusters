# Slopbusters

A local PR review workspace that puts the code first. Pick a GitHub repository, separate your PRs from other authors’ PRs, and review related diff sections together.

Built in TypeScript with React, Vite, and a small Express server. The diff viewer, worker pool, buttons, inputs, badges, and dialogs are adapted directly from [T3 Code](https://github.com/pingdotgg/t3code). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the pinned source and MIT attribution.

## Run

Requires Node 24 or a newer supported version, pnpm 9.15.5, and [GitHub CLI](https://cli.github.com/). The repository root pins Node 24.21.0 and pnpm 9.15.5 in `.tool-versions`; `package.json` also declares the pnpm version. Run these commands from the repository root.

```sh
asdf install
pnpm install --frozen-lockfile
gh auth login
pnpm dev
```

If you use asdf, make sure its shims are on your shell's `PATH`. `asdf install` installs the pinned versions; no global version selection is needed. If you use another version manager, select Node 24 and pnpm 9.15.5 there instead.

Open **http://localhost:4310**. For a built version, use `pnpm build` and `pnpm start`, then open http://localhost:4311.

For the Electron desktop app, run `pnpm desktop:dev` instead. `pnpm build` builds the renderer and desktop runtime; `pnpm desktop:start` launches that build. See [the desktop guide](../desktop/README.md).

Sign in to Codex or Claude Code in your terminal first. Automatic PR organization invokes the installed, unmodified CLI with your existing account. There is no separate model API key required for subscription users; any provider environment configuration you already have is inherited. Usage follows your provider’s limits. Installed does not necessarily mean signed in.

## Review flow

1. Pick a repository. “My PRs” uses your GitHub identity; “Others’ PRs” shows other authors; “Review requested” shows direct requests to your account. The repository name in the top bar opens a searchable switcher with your ten most recently visited repositories. Inbox and PR-link visits are saved locally, and the app reopens in the last repository. An explicit repository or PR URL takes precedence.
2. On first launch, choose Codex or Claude and a model. The suggested defaults are Sol 6.1 (`gpt-6.1-sol`) and Opus 5.5 (`claude-opus-5-5`); you can enter another model supported by your CLI. Open a PR to automatically group related edits across files. A centered loader appears while grouping runs, with cancellation and retry on failure. Saved groups reopen immediately; new revisions are grouped automatically. The sidebar lists behavior groups with P1/P2/P3 priority labels. The refresh icon beside Groups regenerates using your current Settings. Group titles sit beside their priority labels, with file and added/removed line counts below. Line counts cover each group's own diff sections, including when a file spans several groups. The model cannot replace the code and its grouping is rejected if any diff section is missing, duplicated, or invented.
3. Select a group to read its related changes in T3’s syntax-highlighted, virtualized viewer. The group sidebar replaces the inbox sidebar while reviewing, leaving more room for the code. The fixed compact header keeps the PR title, source and target branches, total file changes, and a button for the description within reach. Diff lines wrap, including long Markdown lines. Scroll vertically through every section, toggle unified/split in the main header, and inspect exact move/copy markers. Meaningful code edits retain their token highlights; whitespace-only edits avoid extra token backgrounds while remaining present in the diff.
4. Hover a line and click its comment button, or click its line number, to open an inline comment area on original or updated code. Save a local draft, then edit or delete it inline or in the Discussions panel. “Viewed” marks the displayed file sections in the current group and collapses their code; unchecking reopens them. Other sections of the same file remain unviewed. Click the filename or chevron to expand independently of Viewed. Marking a group's last unviewed section advances to the next unfinished group. Completed groups become compact, gray, and struck through. The section counter reports progress, and “Unviewed only” filters reviewed sections out of the diff. Progress and drafts persist in SQLite.
5. “Copy feedback” appears when you have local draft comments or a review summary, and produces text with the PR, commit, source locations, and your comments to paste into T3 Code or any agent. After copying, the button shows a checkmark and “Copied” briefly, then returns to normal. If clipboard access fails, a selectable export opens.
6. Existing GitHub review discussions, including resolved threads, appear below their relevant lines when their locations match this revision. The single Discussions panel combines your local drafts, review summary, and every imported thread, including outdated threads and threads on files outside the current diff. Resolved and outdated threads start collapsed; expand them to read their comments and replies. Location links open the containing group when the discussion refers to a file in the grouped changes. “Reply” opens an editor; the explicit “Post reply to GitHub” button publishes that reply immediately. Replies are separate from local review drafts.
7. “Submit review” previews your local drafts and summary and offers Comment, Request changes, or Approve. The final submit button publishes those new comments together as a review. Line comments retain their actual file/line/side. Submission rejects stale heads or base revisions. Successful submission clears the published feedback while preserving edits made during submission; comments refresh as GitHub discussions and viewed status remains marked.

PR metadata is checked immediately, every 30 seconds while visible, and every two minutes in a background tab. Focus, visibility, and reconnect events trigger a check. New head/base commits, closing, or merging highlight **Updates available** on Reload. The current diff stays in place until you reload. Unchanged, uniquely matching diff sections retain viewed status across revisions; changed context, incomplete patches, and ambiguous duplicate sections require review again. Draft comments and summaries remain tied to the revision on which they were written.

Open **Settings** from the homepage to change the organization provider and model, or use the theme picker. It offers 24 palettes with matching app and syntax colors, including dark and light variants. Settings persist in SQLite; controls stay out of the diff view.

Stack badges in the inbox and review header show a PR's position in its stack. Open one to see the linked chain, current PR, compact status icons, and base branch. Native GitHub stacks take precedence. Where native stacks are unavailable, unambiguous dependencies between repository-qualified head and base branches provide a labeled fallback; title numbering alone does not establish a stack. Draft PRs use gray icons in the inbox.

Check indicators and merge readiness badges appear in the inbox and review header. Open one for individual check results and log links, required approvals, code owner requirements, and user/team reviewers with their decisions. The stack panel includes the same details for every layer, with a manual refresh and background refresh while open. Passing CI alone does not mean ready to merge: GitHub's merge state and review decision determine readiness. Unavailable or incomplete metadata is called out rather than displayed as ready.

My PRs separates conflicts, unresolved comments, reviews, failing CI, pending checks, drafts and other actions, unavailable status, and ready changes. A PR appears in its highest-priority applicable group; status icons still expose its other blockers. Unresolved comments have their own group. Stack rows show the title and PR number, with clickable status icons instead of expanded details or branch labels. The rightmost inbox arrow opens GitHub. The sidebar shows your GitHub avatar and the authentication state of installed coding providers.

PR descriptions render GitHub-flavored Markdown with tables, task lists, fenced code, and collapsible details. HTML is sanitized before rendering.

Use **+20 context** on a file to reveal surrounding unchanged code, or **Browse source** to explore its full base or head version. Expansion stops before changes assigned to another group and preserves the original comment coordinates and viewed-section fingerprints. Source files are read at the snapshot's immutable head or diff merge base. The source browser offers a searchable repository file list, function and class outlines, go-to-line, and back navigation. Select a code token for **Go to definition** or **Find references**; Cmd/Ctrl-click opens definition results.

The desktop bundle includes its syntax grammars and parsers. TypeScript/JavaScript use the bundled TypeScript language service for semantic definitions and references. Other languages use installed stdio language servers: `gopls` for Go, `rust-analyzer` for Rust, `pyright-langserver --stdio` for Python, and defaults for C/C++, Java, C#, Ruby, PHP, Bash, Lua, Kotlin, Swift, Dart, HTML, CSS, JSON, and YAML. **Settings → Source navigation** shows availability and lets you change commands, disable servers, or add any other language and its file extensions. PowerShell requires a local Editor Services stdio launcher configured there. Language servers and their toolchains must already be installed; the app does not install them.

Language servers read temporary source snapshots fetched through `gh api` at the exact PR head or merge-base commit. No Git clone is created. Repeated navigation reuses the same revision/language session; idle sessions expire after two minutes, and their processes and temporary files are removed when the app closes. Cmd/Ctrl-click or **Go to definition** opens a single semantic result directly; multiple results appear in the location list. Tree-sitter still provides outlines and labeled syntax/name matches when no semantic server is available. Other text files remain browsable and searchable.

Repository inboxes have paths such as `/repos/owner/repo/pulls?inbox=others`; PRs use `/repos/owner/repo/pulls/123`. The URL also remembers the revision, selected group, and diff mode. You can bookmark or reload a view, open PR links in another tab, and use browser Back/Forward. “Back to inbox” returns to the same repository and inbox filter.

## Current limits

- Move/copy matching requires exact contiguous text (at least four lines, with meaningful code). Edited moves remain ordinary diffs. Copies are searched in the available merge-base text of the first 30 changed source files, rather than across the entire repository.
- Binary or truncated patches are called out and link to GitHub. PRs whose full file list exceeds GitHub’s API limit are rejected. Large diffs can still be read, but grouping is capped at 220,000 prompt characters.
- Source navigation reads regular text files up to 512 KiB from up to 10,000 saved tree paths. Bundled TypeScript and syntax analysis are bounded to 120 files and 8 MiB; installed language-server snapshots are bounded to 1,000 files, 32 MiB, and one minute of loading. Results are capped at 500 locations; incomplete results are called out. Definitions and references depend on the server, project configuration and installed toolchain. Repository dependencies are not installed, generated files are unavailable, and locations outside the saved snapshot cannot be opened. Rust build scripts and procedural macros are disabled; Go and Cargo dependency downloads are disabled. Other installed servers may invoke their own project tools.
- Review requests to GitHub teams are not yet included in the requested view. Lists show open PRs only. Discussion loading uses paginated GitHub review threads and replies; general PR conversation comments are not included. Outdated discussion locations are shown separately rather than attached to current code.
- Browser development data lives in `.data/reviewer.sqlite`; Electron uses its writable `userData` directory. SQLite stores snapshots, grouping, drafts, viewed-section fingerprints, and preferences. Existing JSON snapshots and current browser drafts migrate on load. Loading a different revision starts a separate comment draft and preserves earlier unsent feedback; unchanged viewed sections carry forward. Data is local and does not sync between computers.
- Coding providers run in a temporary directory with read-only/no-tool settings and a five-minute timeout. This app explicitly passes the model saved in Settings. Opening an ungrouped PR starts a grouping call after first-run setup; reopening an already grouped revision reuses its saved result. Concurrent views share the same running job. Grouping is for arranging attention, not for declaring bugs.
- The server binds to localhost. This is a personal local app, not a hosted multi-user service. There is no automatic fix execution or direct T3 handoff yet; copy/paste works today.

## Development

```sh
pnpm lint
pnpm test
pnpm build
```

Tests cover diff coordinates, move/copy detection, grouping completeness, GitHub review payloads, inbox filtering, URL navigation, discussion pagination and revision checks, and reply validation. Browser checks exercise the live GitHub picker/inbox and PR review interactions without publishing a review.

The app's original code is MIT licensed; copied T3 code retains its own copyright notice. See [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and the [port and publication review](../../docs/reviewer-port.md). The repository README includes a single-line T3 Code credit, and the built app includes its full license notice.
