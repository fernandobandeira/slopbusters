#!/usr/bin/env node
// Keeps apps/reviewer/src/vendor/t3 in step with pingdotgg/t3code.
//
// The vendor tree mirrors upstream paths. Every tracked file is a verbatim copy of
// upstream at the pinned commit, plus an optional patch recorded under patches/.
// Shims are local files that stand in for upstream modules we cannot import.
//
//   node scripts/sync-t3.mjs check            verify tree == upstream(pin) + patches
//   node scripts/sync-t3.mjs patch            regenerate patches from the current tree
//   node scripts/sync-t3.mjs diff [ref]       what changed upstream since the pin
//   node scripts/sync-t3.mjs sync [ref]       pull upstream at ref (default main) and merge
//   node scripts/sync-t3.mjs add <path>...    track more upstream files at the pin

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const vendor = join(root, 'apps/reviewer/src/vendor/t3')
const manifestPath = join(vendor, 'manifest.json')
const patchesDir = join(vendor, 'patches')
const noticesPath = join(root, 'apps/reviewer/THIRD_PARTY_NOTICES.md')
const cache = join(root, 'node_modules/.cache/t3code')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const [command = 'check', ...args] = process.argv.slice(2)

const commands = { check, patch: writePatches, diff: showDiff, sync, add }
if (!(command in commands)) {
  console.error(`Unknown command "${command}". Use check, patch, diff, sync or add.`)
  process.exit(2)
}
await commands[command](args)

// ---------------------------------------------------------------------------
// Commands

async function check() {
  ensureCommit(manifest.commit)
  const failures = []
  const expectedPatches = new Set()
  for (const file of manifest.files) {
    const pristine = upstreamFile(manifest.commit, file.path)
    if (pristine === null) {
      failures.push(`${file.path}: missing upstream at ${short(manifest.commit)}`)
      continue
    }
    const local = readLocal(file.path)
    if (local === null) {
      failures.push(`${file.path}: missing locally; run "pnpm t3:sync ${short(manifest.commit)}"`)
      continue
    }
    const expected = unifiedDiff(file.path, pristine, local)
    if (expected) expectedPatches.add(patchPath(file.path))
    const stored = readIfExists(patchPath(file.path))
    if ((expected ?? '') !== (stored ?? '')) {
      failures.push(`${file.path}: local changes differ from the recorded patch`)
    }
  }
  for (const stray of listPatches().filter((path) => !expectedPatches.has(path))) {
    failures.push(`${relative(vendor, stray)}: patch has no tracked file or no remaining changes`)
  }
  for (const shim of manifest.shims) {
    if (readLocal(shim.path) === null) failures.push(`${shim.path}: shim is missing`)
  }
  if (failures.length > 0) {
    console.error('T3 vendor tree is out of step with its manifest:\n  ' + failures.join('\n  '))
    console.error('\nAfter editing a vendored file, run "pnpm t3:patch" to record the change.')
    process.exit(1)
  }
  console.log(`T3 vendor tree matches upstream ${short(manifest.commit)} plus ${expectedPatches.size} patch(es).`)
}

async function writePatches() {
  ensureCommit(manifest.commit)
  for (const stale of listPatches()) unlinkSync(stale)
  let count = 0
  for (const file of manifest.files) {
    const pristine = upstreamFile(manifest.commit, file.path)
    const local = readLocal(file.path)
    if (pristine === null || local === null) continue
    const diff = unifiedDiff(file.path, pristine, local)
    if (!diff) continue
    writeFile(patchPath(file.path), diff)
    count += 1
    console.log(`recorded ${relative(root, patchPath(file.path))}`)
  }
  removeEmptyDirs(patchesDir)
  console.log(`${count} patch(es) recorded against ${short(manifest.commit)}.`)
}

async function showDiff([ref = 'main']) {
  const target = resolveRef(ref)
  console.log(`Upstream ${short(manifest.commit)}..${short(target)}\n`)
  const tracked = manifest.files.map((file) => file.path)
  const replaced = manifest.shims.map((shim) => shim.replaces)
  console.log(git(['diff', '--stat', manifest.commit, target, '--', ...tracked]) || 'tracked files: no changes')
  console.log('\nModules replaced by shims:')
  console.log(git(['diff', '--stat', manifest.commit, target, '--', ...replaced]) || 'no changes')
}

async function sync([ref = 'main']) {
  const target = resolveRef(ref)
  ensureCommit(manifest.commit)
  if (target === manifest.commit) {
    console.log(`Already pinned to ${short(target)}.`)
  }
  const conflicts = []
  const missing = []
  for (const file of manifest.files) {
    const base = upstreamFile(manifest.commit, file.path)
    const next = upstreamFile(target, file.path)
    const local = readLocal(file.path)
    if (next === null) {
      missing.push(file.path)
      continue
    }
    if (local === null || base === null || local === base) {
      writeLocal(file.path, next)
      continue
    }
    if (next === base) continue
    const merged = mergeFile(file.path, local, base, next)
    writeLocal(file.path, merged.content)
    if (merged.conflicts) conflicts.push(file.path)
  }
  for (const shim of manifest.shims) {
    const stat = git(['diff', '--stat', manifest.commit, target, '--', shim.replaces])
    if (stat) console.log(`shim ${shim.path} replaces a module that changed upstream:\n${stat}`)
  }
  manifest.commit = target
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  updateNotices(target)
  if (missing.length > 0) {
    console.error(`Removed or renamed upstream (kept local copies):\n  ${missing.join('\n  ')}`)
  }
  if (conflicts.length > 0) {
    console.error(`Merge conflicts to resolve, then run "pnpm t3:patch":\n  ${conflicts.join('\n  ')}`)
    process.exit(1)
  }
  await writePatches()
  console.log(`Pinned to ${short(target)}. Run the reviewer lint, test and build before committing.`)
}

async function add(paths) {
  if (paths.length === 0) {
    console.error('Give one or more upstream paths, e.g. apps/web/src/components/ui/tooltip.tsx')
    process.exit(2)
  }
  ensureCommit(manifest.commit)
  for (const path of paths) {
    if (manifest.files.some((file) => file.path === path)) {
      console.log(`${path} is already tracked`)
      continue
    }
    const content = upstreamFile(manifest.commit, path)
    if (content === null) {
      console.error(`${path} does not exist upstream at ${short(manifest.commit)}`)
      process.exit(1)
    }
    writeLocal(path, content)
    manifest.files.push({ path })
    console.log(`added ${path}`)
  }
  manifest.files.sort((a, b) => a.path.localeCompare(b.path))
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

// ---------------------------------------------------------------------------
// Upstream access (blobless clone cached under node_modules)

function ensureClone() {
  if (existsSync(join(cache, '.git', 'HEAD'))) return
  rmSync(cache, { recursive: true, force: true })
  mkdirSync(dirname(cache), { recursive: true })
  console.log(`Cloning ${manifest.repository} (blobless) into ${relative(root, cache)}…`)
  execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', manifest.repository, cache], {
    stdio: 'inherit',
  })
}

function ensureCommit(commit) {
  ensureClone()
  if (hasCommit(commit)) return
  execFileSync('git', ['-C', cache, 'fetch', '--quiet', 'origin'], { stdio: 'inherit' })
  if (!hasCommit(commit)) throw new Error(`Commit ${commit} is not reachable from ${manifest.repository}`)
}

/** Full commit id for a branch, tag or (abbreviated) commit, fetching from origin as needed. */
function resolveRef(ref) {
  ensureClone()
  const fetch = spawnSync('git', ['-C', cache, 'fetch', '--quiet', 'origin', ref], { encoding: 'utf8' })
  if (fetch.status === 0) return git(['rev-parse', 'FETCH_HEAD'])
  execFileSync('git', ['-C', cache, 'fetch', '--quiet', 'origin'], { stdio: 'inherit' })
  if (!hasCommit(ref)) throw new Error(`"${ref}" is not a branch, tag or commit of ${manifest.repository}`)
  return git(['rev-parse', `${ref}^{commit}`])
}

function hasCommit(ref) {
  return spawnSync('git', ['-C', cache, 'cat-file', '-e', `${ref}^{commit}`]).status === 0
}

function upstreamFile(commit, path) {
  const result = spawnSync('git', ['-C', cache, 'show', `${commit}:${path}`], { maxBuffer: 64 * 1024 * 1024 })
  return result.status === 0 ? result.stdout.toString('utf8') : null
}

function git(args) {
  return execFileSync('git', ['-C', cache, ...args], { encoding: 'utf8' }).trim()
}

// ---------------------------------------------------------------------------
// Local tree, patches, merges

function readLocal(path) {
  return readIfExists(join(vendor, path))
}

function writeLocal(path, content) {
  writeFile(join(vendor, path), content)
}

function patchPath(path) {
  return join(patchesDir, `${path}.patch`)
}

function listPatches(dir = patchesDir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listPatches(full) : full.endsWith('.patch') ? [full] : []
  })
}

function unifiedDiff(path, before, after) {
  if (before === after) return null
  return withTempFiles({ before, after }, (files) => {
    const result = spawnSync('diff', ['-u', '--label', `a/${path}`, '--label', `b/${path}`, files.before, files.after], {
      encoding: 'utf8',
    })
    if (result.status !== 1) throw new Error(`diff failed for ${path}: ${result.stderr}`)
    return result.stdout
  })
}

function mergeFile(path, local, base, next) {
  return withTempFiles({ local, base, next }, (files) => {
    const result = spawnSync(
      'git',
      ['merge-file', '-p', '-L', `local ${path}`, '-L', `upstream ${short(manifest.commit)}`, '-L', 'upstream', files.local, files.base, files.next],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    if (result.status < 0 || result.status === null) throw new Error(`merge failed for ${path}: ${result.stderr}`)
    return { content: result.stdout, conflicts: result.status }
  })
}

function withTempFiles(contents, run) {
  const dir = mkdtempSync(join(tmpdir(), 't3-sync-'))
  try {
    const files = {}
    for (const [name, content] of Object.entries(contents)) {
      files[name] = join(dir, name)
      writeFileSync(files[name], content)
    }
    return run(files)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function updateNotices(commit) {
  const notices = readFileSync(noticesPath, 'utf8')
  const updated = notices.replace(/pinned to commit `[0-9a-f]{40}`/, `pinned to commit \`${commit}\``)
  if (updated !== notices) writeFileSync(noticesPath, updated)
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function removeEmptyDirs(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) removeEmptyDirs(full)
  }
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
}

function short(commit) {
  return commit.slice(0, 12)
}
