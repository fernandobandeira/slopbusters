# Third-party notices

## Review app

The Slopbusters review app was ported from Review Room at commit `06af2d76d8a1ad71dab48a23a783a208c7b88361`. Its MIT license and copyright notice are retained in [apps/reviewer/LICENSE](apps/reviewer/LICENSE). That license covers the review app's original code; it does not assign a license to the rest of this repository.

The app includes adapted code from [T3 Code](https://github.com/pingdotgg/t3code) at commit `f391794a35c604d57e166a3ab48d56fc6e4e469a`. The original MIT license is preserved in [apps/reviewer/src/vendor/t3/LICENSE](apps/reviewer/src/vendor/t3/LICENSE). [The app's notices](apps/reviewer/THIRD_PARTY_NOTICES.md) list the copied files and adaptations. Production builds also include `T3_CODE_LICENSE.txt`.

Package dependencies retain their own licenses. The [dependency inventory](docs/reviewer-dependency-licenses.json) records the installed metadata for the pinned lockfile, including development dependencies. This inventory is a provenance aid, not a replacement for package copyright notices and license texts when distributing dependencies or compiled bundles.

## Themes and desktop runtime

The theme picker uses Shiki themes bundled with the installed Pierre diff viewer. Their original theme notices are preserved from `tm-themes@1.12.12` in [the theme source record](apps/reviewer/src/vendor/themes/README.md), [LICENSE](apps/reviewer/src/vendor/themes/LICENSE), and [NOTICE](apps/reviewer/src/vendor/themes/NOTICE). Builds include `THEME_LICENSE.txt` and `THEME_NOTICES.txt`.

Electron is pinned to version `44.4.2`. Desktop builds include `ELECTRON_LICENSE.txt`, `CHROMIUM_LICENSES.html`, and `DEPENDENCY_LICENSES.txt` alongside the reviewer and T3 license files. Dependency notices are collected from installed runtime packages for each build; the runtime's bundled Chromium notices are copied from the pinned Electron distribution.

Slopbusters is an independent project. Attribution does not imply endorsement by T3 Tools Inc. A single-line credit appears at the bottom of the repository README.

## Source parsers

The desktop backend includes unmodified WebAssembly source parsers from `@vscode/tree-sitter-wasm@0.3.1`. Original runtime and grammar license texts are retained in [SOURCE_PARSER_NOTICES.txt](apps/reviewer/vendor/source-parser/SOURCE_PARSER_NOTICES.txt), with [pinned sources and binary hashes](apps/reviewer/vendor/source-parser/sources.json) and [the provenance record](apps/reviewer/vendor/source-parser/README.md). The bundled INI grammar uses Apache-2.0; the other recorded grammar and runtime sources use MIT. Desktop builds verify the installed binaries against that record and include `SOURCE_PARSER_NOTICES.txt`, `SOURCE_PARSER_ASSETS.json`, and `SOURCE_PARSER_PROVENANCE.md` with the app.

## GitHub gh-stack references

The existing `skills/linus/references/gh-stack` files come from GitHub's gh-stack agent skill. Their [source record](skills/linus/references/gh-stack/SOURCE.md) and [MIT license](skills/linus/references/gh-stack/LICENSE) are preserved.
