import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const baseline = JSON.parse(readFileSync(new URL('./audit-baseline.json', import.meta.url), 'utf8'))
const result = spawnSync('pnpm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
if (result.error) throw result.error
const report = JSON.parse(result.stdout)
if (report.error || !report.advisories || result.status === null) {
  throw new Error(report.error?.message ?? result.stderr ?? 'Dependency audit failed.')
}
let failed = false
for (const advisory of Object.values(report.advisories)) {
  if (!['high', 'critical'].includes(advisory.severity)) continue
  const known = baseline.find((entry) => entry.id === advisory.github_advisory_id)
  const permitted = known && Date.now() < Date.parse(known.expires) &&
    advisory.findings.every((finding) => finding.version === known.version &&
      finding.paths.every((path) => known.paths.includes(path)))
  if (permitted) {
    console.warn(`Recorded build-tool advisory ${known.id}; expires ${known.expires}. ${known.reason}`)
  } else {
    console.error(`${advisory.severity}: ${advisory.title}\n${advisory.url}`)
    failed = true
  }
}
if (failed) process.exitCode = 1
