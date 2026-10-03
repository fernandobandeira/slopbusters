# Source parser provenance

The desktop app bundles the unmodified WebAssembly assets from
`@vscode/tree-sitter-wasm@0.3.1`. They run in the local backend; the renderer
receives source symbols and never loads these parser assets.

Microsoft's package is MIT licensed, but its bundled grammar binaries also
carry their upstream licenses. `SOURCE_PARSER_NOTICES.txt` retains those full
texts, including the **Apache-2.0** license for `tree-sitter-ini` by Justin M.
Keyes. The remaining recorded grammar and runtime sources are MIT licensed.
The pinned INI source has no separate NOTICE file. No grammar was modified.

`sources.json` records the source packages, integrity values, pinned Git
revisions, and SHA-256 digest of every distributed WASM file. NPM source
tarballs were checked against the integrity values in Microsoft's pinned
package lock before extracting their license files. The JavaScript grammar
inherited by TypeScript is recorded separately from the standalone JavaScript
grammar.

The upstream build configuration is pinned to Microsoft release `v0.3.1`,
commit `78c97c860ddd965b9617f0e30962ad1da08c4c91`:

- [Build configuration](https://github.com/microsoft/vscode-tree-sitter-wasm/blob/78c97c860ddd965b9617f0e30962ad1da08c4c91/build/main.ts)
- [Pinned dependency lock](https://github.com/microsoft/vscode-tree-sitter-wasm/blob/78c97c860ddd965b9617f0e30962ad1da08c4c91/package-lock.json)
- [Tree-sitter INI source](https://github.com/justinmk/tree-sitter-ini/tree/f0285fe577ad298ad79f8633e643ad60646e3027)

The release build script uses Tree-sitter `v0.25.10`; the package's
`cgmanifest.json` still lists `0.25.1`. The runtime license was retained from
the build script's pinned tag. Binary identity is recorded directly from the
published package instead of assuming that the stale component manifest
proves the runtime's version.

Desktop builds verify every asset against this record, copy only the WASM
files to `dist/syntax`, and include the complete parser notices and source
record beside the other distribution notices. Builds use local installed
assets and do not fetch parser files or licenses.
