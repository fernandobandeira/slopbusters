# Local repository context for PR review

Slopbusters prepares independent local Git checkouts at the saved PR head or diff merge-base commit. Source navigation and repository-aware Codex/Claude agents use these checkouts to inspect code outside the diff. The app never switches branches or modifies an existing user clone.

## Checkout choice

Each `(owner, repository, commit)` has its own shallow, detached checkout under the app's data directory:

```text
review-workspaces/<owner>/<repository>/<commit>/
```

The existing bare source cache supplies Git objects. Fetching those objects into a new repository copies them without shared object alternates, hardlinks, or worktree metadata. The checkout can therefore survive cache removal and remains reusable offline after restart. Different PR revisions and the old/new diff sides use separate directories. Reopening a PR never substitutes a newer branch for its saved commit.

This trades some disk space for independence. Worktrees would couple checkout lifecycle to a shared Git directory; creating them from a user's repository would also mutate its metadata. A user-folder picker and environment reuse are deferred. This implementation works without knowing a repository's language, test command, services, or environment files.

## Shared services

```mermaid
flowchart TD
  PR[Saved PR commits] --> Cache[Bare Git object cache]
  Cache --> Checkouts[Independent local checkouts]
  Checkouts --> TS[Bundled TypeScript worker]
  Checkouts --> LSP[Installed stdio language servers]
  TS --> Navigation[Revision-aware navigation]
  LSP --> Navigation
  Navigation --> UI[Source modal]
  Checkouts --> Copy[Disposable scrubbed copy per model pass]
  Copy --> Agents[Codex and Claude threads on the bundled T3 Code engine]
```

`ReviewWorkspaces` coalesces concurrent preparation, validates exact HEAD and cleanliness, creates checkouts atomically, and tracks active leases. Settings lists completed copies and can remove unused ones. Cleanup refuses a copy with unexpected edits, untracked files, or an active review. It never resets or cleans a changed directory. Interrupted preparation is removed on ordinary failure; an abrupt process termination may leave an unused `.preparing-*` directory.

TypeScript/JavaScript analysis runs in a persistent worker outside Electron's main thread. It reads the full project configuration, nested tsconfig/jsconfig files, project references, committed workspace package sources, and bundled standard libraries. Configured language plugins are disabled. Other languages use the existing configurable installed stdio servers with the full checkout and project configuration available. Sessions are keyed by repository, revision, and language/project; idle sessions can be retired without removing the checkout.

GitHub API source loading and the older bounded snapshot analyzer remain explicit fallbacks if a local revision cannot be prepared. Context expansion prefers local immutable blobs. Returned semantic locations identify the saved SHA and whether analysis used a checkout or snapshot. Only committed regular source files can be opened as review evidence.

## Agent inspection

Linus and Uncle Bob lease the saved head checkout before starting their two independent reviewers; both reviewers and reconciliation read the same checkout, and the lease is released once the last model pass ends. Jobs leases a checkout of the repository's default branch. Gandalf works in its own conflict checkout. Lightweight diff grouping still uses supplied text, in an empty scratch directory.

Every model pass is a structured turn on the T3 Code engine Slopbusters bundles (`StructuredTurns` in `server/adapters/t3Engine`). The runner copies the checkout into a throwaway directory (a copy-on-write clone on macOS), removes the repository's agent and editor configuration (`.claude`, `.mcp.json`, `.codex`, `.cursor`, `.gemini`, `.vscode`) and `.git` from it, and starts a thread in its own engine project there. The agent reads and searches files with its own tools; there are no Slopbusters tools, and semantic navigation stays in the UI. Claude runs with approvals required and every approval is declined, so it can read but not edit or run commands. Codex runs sandboxed to the copy. Prompts treat repository files as untrusted data and ask for a JSON reply, which is validated against the feature's schema; a reply that does not match gets one corrective turn. Cancellation or a timeout interrupts the turn; the thread is archived and the project and copy deleted when the pass ends.

This does not turn the wording audit into a general code-review agent or execute tests. CI continues to own lint/test checks and merge gates. No dependencies, environment files, services, build steps, or setup scripts are provisioned automatically.

## Navigation behavior

A single semantic definition opens and highlights its destination. The source modal retains Back/Forward history. Repeating a jump at the current declaration reports “Already at this definition” without reloading its file. An unresolved symbol reports the missing result while preserving the current source. Configuration and missing-import diagnostics remain visible rather than being hidden. Multiple locations retain the existing chooser.

The reported `FboAccountPurpose` project was not used as a fixture. Synthetic regressions cover aliases and enum declarations, same-location handling, unresolved results, large projects, workspace package exports, nested configuration, both revisions, and installed-server transport. They verify the architecture and failure behavior without assuming this particular repository's setup.

## Limits and verification

Local source does not guarantee complete semantic resolution. Missing dependencies, generated output, package-based inherited configuration, Git LFS contents, and submodules can still prevent a jump. No submodules, LFS objects, or checkout filters are downloaded or run. Source inspection opens text files up to 512 KiB; analysis reads source files up to 2 MiB; navigation returns up to 500 locations. Installed language servers may invoke their own project tools; configuring one requires an existing local toolchain.

Tests exercise real temporary Git repositories, clean/dirty restart behavior, unchanged user branches, independent object storage, offline reuse, application APIs, worker navigation, stdio LSP requests, scrubbed inspection copies, the engine turn protocol, and checkout lease lifecycle. The Electron smoke test exercises the shipped worker and standard libraries separately from renderer fixtures, and verifies source history and resolution notices in the actual sandboxed renderer. Provider integration tests do not make paid model calls.
