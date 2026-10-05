import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appDirectory = fileURLToPath(new URL('../apps/reviewer/', import.meta.url))
const report = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--json'], {
    cwd: appDirectory,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }),
)
const packages = Object.entries(report)
  .flatMap(([license, entries]) =>
    entries.map((entry) => ({
      name: entry.name,
      versions: [...entry.versions].sort(),
      license,
      ...(entry.homepage ? { homepage: entry.homepage } : {}),
    })),
  )
  .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

const allowedLicenses = new Set([
  'MIT', 'Apache-2.0', 'apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause',
  '0BSD', 'Python-2.0', 'CC-BY-4.0', 'BlueOak-1.0.0', 'MPL-2.0',
  'WTFPL', 'WTFPL OR ISC', '(WTFPL OR MIT)', '(MIT OR CC0-1.0)',
])
const forbidden = packages.filter((entry) => !allowedLicenses.has(entry.license))
if (forbidden.length) {
  throw new Error(`Unapproved dependency licenses: ${forbidden.map((entry) => `${entry.name}: ${entry.license}`).join(', ')}`)
}
if (process.argv.includes('--check')) {
  console.log(`Checked approved licenses for ${packages.length} installed dependency entries.`)
  process.exit(0)
}

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../docs/reviewer-dependency-licenses.json', import.meta.url),
  `${JSON.stringify(
    {
      description:
        'Installed package metadata for the pinned reviewer lockfile; includes build and development dependencies. Recheck when dependencies change.',
      packages,
    },
    null,
    2,
  )}\n`,
)
console.log(`Recorded license metadata for ${packages.length} installed dependency entries.`)
