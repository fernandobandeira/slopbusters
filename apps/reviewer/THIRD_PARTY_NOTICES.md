# T3 Code

This project includes code from [pingdotgg/t3code](https://github.com/pingdotgg/t3code), pinned to commit `f391794a35c604d57e166a3ab48d56fc6e4e469a`, under the MIT License. The original license is preserved in [src/vendor/t3/LICENSE](src/vendor/t3/LICENSE).

The following files originated under `apps/web/src/` at that commit:

- `components/ui/{button,badge,input,dialog,scroll-area}.tsx` and `components/ui/dialog-styles.ts`: reused with their original appearance and Base UI behavior.
- `components/diffs/StyledDiffCodeView.tsx`: preserves T3’s shadow-root styling and virtualized geometry; types adapted to the installed Pierre viewer’s additional generic parameter. Slopbusters pairs its 22px line styling with matching virtual row metrics and adds space below the final file.
- `components/ProviderLogos.tsx`: only the OpenAI and ClaudeAI SVG components are extracted from upstream `components/Icons.tsx`; their fill classes are adapted to direct SVG fill attributes. These marks identify the installed providers and do not imply endorsement.
- `components/DiffWorkerPoolProvider.tsx`: preserves T3’s shared worker lifecycle, readiness and theme synchronization; its Effect error wrapper is replaced with a native Error.
- `lib/diffRendering.ts`: the shared diff surface CSS and theme resolver are extracted; application-specific patch utilities are omitted.
- `lib/utils.ts`: only `cn` and its Tailwind merge configuration are extracted.
- `lib/syntaxHighlighting.ts`: the preferred WASM highlighter constant is extracted.

The local theme hook supplies the selected app and diff theme; the worker pool accepts the viewer's bundled theme names. `src/diffItems.ts` adapts T3’s compact partial-hunk offsets while preserving source coordinates. The surrounding repository inbox, grouping workflow, SQLite draft storage, review progress, review submission, and layout are specific to Slopbusters. Theme provenance and notices are preserved separately in [src/vendor/themes](src/vendor/themes/README.md).

The temporary `.reference/t3code` checkout from Review Room was excluded from this port and is not required to run the app. The repository README credits T3 Code, and production builds preserve its full license in `T3_CODE_LICENSE.txt`. Slopbusters is an independent project, not an official T3 product.

The app was ported from Review Room commit `06af2d76d8a1ad71dab48a23a783a208c7b88361`. The original MIT copyright notice is retained in [LICENSE](LICENSE). Packaged builds include dependency license texts in `DEPENDENCY_LICENSES.txt`, alongside Electron and Chromium notices.
