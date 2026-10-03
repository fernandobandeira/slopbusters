import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(process.argv[2] ?? 'apps/reviewer/dist')
const report = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
)
const entries = Object.entries(report)
  .flatMap(([license, packages]) => packages.map((entry) => ({ ...entry, license })))
  .sort((left, right) => left.name.localeCompare(right.name))

const sections = [
  'Slopbusters third-party dependency notices',
  'Collected from installed runtime dependencies for this build. Electron and Chromium license files accompany the desktop runtime. The original T3 Code license is included separately in T3_CODE_LICENSE.txt.',
]
for (const entry of entries) {
  const texts = new Set()
  for (const directory of entry.paths) {
    const files = readdirSync(directory, { withFileTypes: true })
    const notices = files.filter((file) => file.isFile() && /^(license|licence|notice|copying)(\.|$)/i.test(file.name))
    for (const file of notices) texts.add(readFileSync(resolve(directory, file.name), 'utf8'))
    if (!notices.length) {
      // Several dependencies keep their license or attribution in the readme.
      const readme = files.find((file) => file.isFile() && /^readme(\.|$)/i.test(file.name))
      if (readme) texts.add(readFileSync(resolve(directory, readme.name), 'utf8'))
    }
  }
  sections.push(
    `${entry.name} (${entry.versions.join(', ')})\nLicense: ${entry.license}\n${entry.homepage ?? ''}\n${typeof entry.author === 'string' ? entry.author : ''}\n\n${[...texts].join('\n\n') || 'See the package upstream for its license text.'}`,
  )
}
mkdirSync(destination, { recursive: true })
writeFileSync(resolve(destination, 'DEPENDENCY_LICENSES.txt'), sections.join('\n\n============================================================\n\n') + '\n')
console.log(`Included notices for ${entries.length} runtime dependency entries.`)
