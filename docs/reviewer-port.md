# Reviewer port and publication review

Slopbusters now includes an Electron application for reviewing GitHub pull requests, alongside its existing skills and plugins. Its React/Express reviewer was ported from the local `review-room` repository at commit `06af2d76d8a1ad71dab48a23a783a208c7b88361`, placed under `apps/reviewer`. `apps/desktop` supplies the Electron runtime and packaging.

## Included source

The port copies the review app's tracked React, Express, shared TypeScript, tests, configuration, and documentation. It retains grouping, discussion, and submission behavior and adds SQLite snapshots, drafts, viewed-section fingerprints, and preferences. Background metadata checks highlight updates without replacing the current diff. Unchanged, uniquely matching sections remain viewed after reload. Visible branding, browser storage keys, and temporary-directory prefixes use Slopbusters. The app uses the user's installed GitHub and coding CLIs.

T3 Code-derived files stay under `apps/reviewer/src/vendor/t3`. The source pin and per-file adaptations are in [the app's notices](../apps/reviewer/THIRD_PARTY_NOTICES.md). The preserved license was compared byte-for-byte with the local checkout at that pin and verified against the [upstream license](https://github.com/pingdotgg/t3code/blob/f391794a35c604d57e166a3ab48d56fc6e4e469a/LICENSE).

The pinned MIT license permits copying, modification, and distribution with its copyright and permission notice included. Those notices remain in the source tree, and production builds emit the full T3 license as `T3_CODE_LICENSE.txt`. The requested one-line credit appears at the bottom of the repository README. The application uses the existing Slopbusters logo for its sidebar, favicon, and desktop icons.

Review Room's original MIT copyright notice is retained in the app license, alongside a Slopbusters contributor notice. The app license is scoped to the imported app; pre-existing skills, artwork, and archived material are not relicensed by this change.

## Excluded local material

Only tracked files from Review Room were copied. Its `.git`, `.reference/t3code`, `.data` PR snapshots, `node_modules`, built output, and environment files were excluded. Root and app ignore rules exclude cached reviews, environment files, dependencies, and build output from normal Git staging. Tests use synthetic repositories and code rather than cached private PRs.

Loading a private PR caches its content locally. Choosing “Organize changes” sends that PR's title, description, and diff sections to the selected coding provider through its CLI. These runtime actions are separate from publishing the source repository.

## Dependency review

[The dependency inventory](reviewer-dependency-licenses.json) captures package names, installed versions, license declarations, and upstream URLs without local filesystem paths. It includes build and development dependencies, and is a snapshot for the imported lockfile. Run `pnpm licenses:reviewer` after installing to refresh it. Platform-specific installed packages can differ between systems.

The metadata includes MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, MPL-2.0, and CC-BY-4.0. In particular, the Pierre diff packages declare Apache-2.0, Lightning CSS declares MPL-2.0, and the caniuse-lite dataset declares CC-BY-4.0. Dependencies are installed from the lockfile rather than copied into the public source tree.

Theme notices are preserved from the `tm-themes@1.12.12` package matching the installed Shiki themes. The theme source record, full license, and attribution text live under `apps/reviewer/src/vendor/themes`; builds emit `THEME_LICENSE.txt` and `THEME_NOTICES.txt`. Settings offers these existing palettes without copying unrelated theme repositories.

The application bundles TypeScript's parser and language service plus unmodified WASM assets from `@vscode/tree-sitter-wasm@0.3.1`. The [parser source record](../apps/reviewer/vendor/source-parser/README.md) retains upstream pins, package integrity values, asset hashes, and full grammar licenses. These include the INI grammar's Apache-2.0 license alongside MIT components. Desktop builds verify the recorded hashes and emit `SOURCE_PARSER_NOTICES.txt` and the source manifest. Parser and syntax assets are included in the app; users do not install them separately.

Source navigation uses independent, shallow local checkouts at immutable saved head/merge-base commits. TypeScript/JavaScript analyze complete project configuration in a bundled worker; other languages use configured installed stdio language servers. Symlinks and submodules cannot be opened as source targets. The app does not install dependencies, run checkout filters, load TypeScript configuration plugins, or provision project environments; installed language servers may invoke their own project tools. Bounded snapshot analysis remains a labeled fallback. Linus audits use the same checkouts and navigation through authenticated read-only MCP tools. Full-source grammar context improves fragment highlighting without changing visible hunk geometry. Context expansion stops before omitted changes and leaves canonical review coordinates and fingerprints intact. See [local review workspaces](local-review-workspaces.md) for lifecycle and limits.

Desktop builds collect runtime dependency license and notice texts into `DEPENDENCY_LICENSES.txt` and include the reviewer, T3, and theme notices. They also copy the pinned Electron license and its bundled Chromium third-party notices. The local application bundle was built and tested; no signed installer or public release has been published. When publishing installers, review the notices and source obligations for the actual artifacts and platform packages being distributed.

Recheck the inventory and upstream notices when changing dependencies or copying additional files. The repository's pre-existing assets and archived material need their own provenance review before claiming a single license for the entire repository.

## Validation

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm desktop:smoke
```

The regression suite covers diff coordinates, move/copy matching, grouping coverage, review payloads, discussions, SQLite restoration and revision matching, update polling, themes, and routes. Native and branch-derived stack detection uses synthetic fixtures, including ambiguous branches and fork collisions. It also covers action grouping, Markdown sanitization, verified account state, exact-revision source reads, bounded context, grammar-state highlighting and worker fallback, multiple bundled parser languages, and cross-file definitions/references with aliases and shadowing. The [review app workflow](../.github/workflows/reviewer.yml) runs checks when app or workspace files change, including an Electron smoke test with a Linux display server.

Browser checks exercise the inbox, grouped diff viewer, move markers, settings, addition colors, and durable section progress using synthetic fixtures. Native smoke tests verify the mounted renderer, sandbox, SQLite runtime, preferences across restart, and saving before quit. No review, reply, or provider grouping call is submitted during verification. Cached PRs, credentials, environment files, installed dependencies, and application bundles are excluded from Git-visible source.
