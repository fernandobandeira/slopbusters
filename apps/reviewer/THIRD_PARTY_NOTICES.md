# T3 Code

This project includes code from [pingdotgg/t3code](https://github.com/pingdotgg/t3code), pinned to commit `5753207d53362608f281738eda3a9faf4e13b6be`, under the MIT License. The original license is preserved in [src/vendor/t3/LICENSE](src/vendor/t3/LICENSE).

The vendored files live under `src/vendor/t3` at their upstream paths and are verbatim copies of that commit. [The manifest](src/vendor/t3/manifest.json) lists every tracked file. The only local changes are recorded as unified diffs under `src/vendor/t3/patches`, and `pnpm t3:check` fails when the tree differs from upstream plus those patches. Three shims listed in the manifest stand in for upstream modules the reviewer cannot import: its theme store, its id helpers, and its Electron title-bar measurement. `pnpm t3:sync` pulls a newer upstream commit and three-way merges the patches.

Tracked files, under `apps/web/src/` unless noted:

- `components/ui/{button,badge,input,dialog,dialog-styles,scroll-area,tooltip}`: unchanged.
- `components/diffs/StyledDiffCodeView.tsx`: patched to pin a 22px row height in both the stylesheet and the virtual row metrics, and to add space between and below files.
- `components/DiffWorkerPoolProvider.tsx`: patched to take the app's diff worker factory from the theme shim and to replace the `effect` error schema with a plain `Error`.
- `components/chat/TimelineSystemDivider.tsx` and `components/Icons.tsx`: unchanged. Only the OpenAI and Claude marks are rendered; they identify the installed providers and do not imply endorsement.
- `lib/diffRendering.ts`: patched to import Pierre helpers from its main entry and to pass bundled Shiki theme names through the theme resolver.
- `lib/syntaxHighlighting.ts` and `packages/shared/src/gitPatchPath.ts`: unchanged.

The server's T3 Code engine client uses the engine's API contracts, copied verbatim from upstream `packages/contracts` into `vendor/t3-engine` with test files excluded. The engine contracts are pinned to `v0.0.45` (commit `6c8fed35dded9ff71c5b46807125457acbb76be6`), the T3 Code release the client speaks to, and the same MIT license is kept in `vendor/t3-engine/LICENSE`. They have no local changes.

The desktop app also bundles that release of the T3 Code engine itself: the unmodified `@t3code/t3-<platform>` build T3 publishes to npm, at the same version as the contracts (`pnpm t3:check` enforces this). It ships under `t3-engine` in the app's resources, outside the application archive and with T3's own code signature, and Slopbusters runs it as a separate process. T3 Code is MIT licensed, and the build carries the license inventory of its web client in `t3-engine/client/third-party-licenses.json`.

The reviewer's `src/components/SessionMarkdown.tsx` follows the sanitized Markdown pipeline of T3's `ChatMarkdown.tsx` without copying it, and `src/components/ReviewDiffCodeView.tsx` layers the review chrome over the vendored viewer through its props. The surrounding repository inbox, grouping workflow, SQLite draft storage, review progress, review submission, and layout are specific to Slopbusters. Theme provenance and notices are preserved separately in [src/vendor/themes](src/vendor/themes/README.md).

The repository README credits T3 Code, and production builds preserve its full license in `T3_CODE_LICENSE.txt`. Slopbusters is an independent project, not an official T3 product.

The app was ported from Review Room commit `06af2d76d8a1ad71dab48a23a783a208c7b88361`. The original MIT copyright notice is retained in [LICENSE](LICENSE). Packaged builds include dependency license texts in `DEPENDENCY_LICENSES.txt`, alongside Electron and Chromium notices.
