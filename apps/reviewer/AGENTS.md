# Reviewer boundaries

- `server/app.ts` composes services, middleware and routers. Keep route handlers in `server/http`.
- Every HTTP route has a zod contract in `shared/api`. Register it with `handle` and call it with `call`; never cast a fetched response. Validate responses as well as requests.
- `shared` is the narrow waist: domain types, contracts and pure rules. No Node builtins, React, Express, filesystem or process calls.
- I/O belongs in `server/adapters`. Git uses `hardenedGit`; GitHub uses the injected `GitHub` object's `rest`, `graphql` and `paginate`. Build on the bounded process runner.
- Services and caches belong to a server instance. Reuse `createCache` for LRU bounds, bytes, TTLs and concurrent loads; do not add module-global request caches.
- Only `UserError` carries a message safe to show. Log unexpected failures and return a generic 500. Best-effort fallbacks must report a warning or log the failure.
- Vendor code is a leaf and receives app behavior through props or context. Import T3 code through `~` (their `apps/web/src`) or `@t3tools/shared` (their `packages/shared/src`).
- `src/vendor/t3` mirrors upstream T3 Code paths and is kept verbatim at the commit in its `manifest.json`. Prefer wrapping a vendored module (see `src/components/ReviewDiffCodeView.tsx`) over editing it. If you must edit one, keep the change minimal, mark it with a `Slopbusters:` comment, and run `pnpm t3:patch` from the repository root so it is recorded under `src/vendor/t3/patches`; `pnpm t3:check` runs in CI. Shims listed in the manifest are ours and never synced. To take upstream changes, run `pnpm t3:diff` then `pnpm t3:sync [ref]`, resolve any conflict markers, run `pnpm t3:patch`, and then lint, test and build. To vendor another upstream file, run `pnpm t3:add <upstream path>`.
- The reviewer talks to the user's running T3 Code through `server/adapters/t3Engine`: it pairs once with `t3 pair`, keeps the bearer session in the `secrets` table, and calls the engine's typed WebSocket API. Features depend on `EngineThreadOperations`, never on the RPC client. The engine's contracts are vendored verbatim under `vendor/t3-engine` at the release tag of the engine version we target, and are imported as `@t3tools/contracts`. Move to a newer engine with `pnpm t3:sync --tree engine <tag>`; it reports the exact `effect` version apps/reviewer must then depend on, and `pnpm t3:check` fails until it matches. Tests encode every command we send with the contracts' own schemas.
- Feature modules stay inside their feature. Compose features in `src/app`; shared browser utilities live in `src/lib`, reusable components in `src/components`.
- Keep entry points short; extract hooks and components around a named behavior. Put high-level operations before details.
- Use `server/limits.ts` for server resource limits and timeouts. Do not execute repository configuration, hooks, filters or install scripts during source inspection.

The pre-commit hook validates the exact staged snapshot in a temporary directory. Preserve concurrent work; never reset, stash or rewrite unrelated edits to make checks pass.

Before committing, run `pnpm --dir apps/reviewer lint`, `pnpm --dir apps/reviewer test` and `pnpm --dir apps/reviewer build`. Lint includes typecheck, formatting, dependency rules and unused-code checks. Add behavioral tests at adapter boundaries and for meaningful interactive flows.

Dependency and ESLint baselines are ratchets, not blanket exemptions. Do not grow them to make a new change pass. Shrink them after fixing a recorded violation with `pnpm architecture:prune` and `pnpm lint:prune`. Explain deliberate changes to a boundary before changing a rule. ESLint suppressions count violations by file and rule; they cannot detect a same-count replacement.

The dependency baseline records existing imports between browser features; the server/shared/browser/vendor safety rules have no baseline exemptions. ESLint records remaining legacy size, complexity and strict-rule violations after the feature moves. Fix a baseline violation rather than copying it into new code. `pnpm unused` has no baseline exemptions.

CI also runs `pnpm audit:check`, `pnpm dedupe:check` and `pnpm licenses:check`. The audit baseline allows only a recorded dependency path/version until its expiry; new high or critical findings fail. The current Electron build-only advisory has no published fix and expires on 2026-11-04. Review upstream before then. The license allowlist records the licenses already present in the dependency inventory; additions require a deliberate policy change.
