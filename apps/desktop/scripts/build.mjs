import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const destination = resolve(directory, 'dist')
await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
await cp(resolve(directory, '../../assets/slopbusters.png'), resolve(destination, 'icon.png'))
const parserNoticesDirectory = resolve(directory, '../reviewer/vendor/source-parser')
const parserRecord = JSON.parse(await readFile(resolve(parserNoticesDirectory, 'sources.json'), 'utf8'))
const reviewerRequire = createRequire(resolve(directory, '../reviewer/package.json'))
const parserPackage = JSON.parse(await readFile(reviewerRequire.resolve('@vscode/tree-sitter-wasm/package.json'), 'utf8'))
if (parserPackage.version !== parserRecord.version) {
  throw new Error('Source parser package changed. Update the pinned asset and license audit before distributing it.')
}
const parserAssetsDirectory = dirname(reviewerRequire.resolve('@vscode/tree-sitter-wasm'))
await mkdir(resolve(destination, 'syntax'), { recursive: true })
for (const asset of parserRecord.assets) {
  const source = resolve(parserAssetsDirectory, asset.file)
  const bytes = await readFile(source)
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Source parser asset ${asset.file} does not match the audited package.`)
  }
  await cp(source, resolve(destination, 'syntax', asset.file))
}
await cp(resolve(parserNoticesDirectory, 'SOURCE_PARSER_NOTICES.txt'), resolve(destination, 'SOURCE_PARSER_NOTICES.txt'))
await cp(resolve(parserNoticesDirectory, 'sources.json'), resolve(destination, 'SOURCE_PARSER_ASSETS.json'))
await cp(resolve(parserNoticesDirectory, 'README.md'), resolve(destination, 'SOURCE_PARSER_PROVENANCE.md'))
await build({
  entryPoints: [resolve(directory, 'src/main.cjs')],
  outfile: resolve(destination, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron', 'node:*'],
  legalComments: 'eof',
})
await cp(resolve(directory, '../reviewer/dist'), resolve(destination, 'renderer'), {
  recursive: true,
})
await cp(resolve(directory, '../reviewer/LICENSE'), resolve(destination, 'LICENSE'))
await cp(
  resolve(directory, '../reviewer/THIRD_PARTY_NOTICES.md'),
  resolve(destination, 'REVIEWER_THIRD_PARTY_NOTICES.md'),
)
await cp(
  resolve(directory, '../../THIRD_PARTY_NOTICES.md'),
  resolve(destination, 'THIRD_PARTY_NOTICES.md'),
)
// electron-builder removes the archive's top-level notices from the app bundle.
// Preserve them in our app resources, including Chromium's complete notices.
require('electron') // Download and verify the runtime if postinstall was skipped.
const electronDirectory = dirname(require.resolve('electron/package.json'))
await cp(resolve(electronDirectory, 'LICENSE'), resolve(destination, 'ELECTRON_LICENSE.txt'))
await cp(
  resolve(process.env.ELECTRON_OVERRIDE_DIST_PATH || resolve(electronDirectory, 'dist'), 'LICENSES.chromium.html'),
  resolve(destination, 'CHROMIUM_LICENSES.html'),
)
execFileSync(process.execPath, [
  resolve(directory, '../../scripts/write-distribution-notices.mjs'),
  destination,
], { cwd: resolve(directory, '../..'), stdio: 'inherit' })
