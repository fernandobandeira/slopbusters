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
