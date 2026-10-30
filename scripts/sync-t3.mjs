#!/usr/bin/env node
// Keeps the reviewer's T3 Code vendor trees in step with pingdotgg/t3code.
//
// Each tree mirrors upstream paths. Every tracked file is a verbatim copy of upstream at the
// tree's pinned commit, plus an optional patch recorded under its patches/ directory. Shims are
// local files that stand in for upstream modules we cannot import, or would rather not import
// whole. Any other file in a tree fails the check.
//
// A shim marked `verbatimDeclarations` copies some of the top-level declarations of the module
// it replaces: each must stay identical to upstream's, except those listed in its
// `ownDeclarations`. `check` fails when a copy differs and `sync` rewrites the copies from the new
// upstream, so a narrowed module still picks up upstream's changes to what it keeps.
//
//   ui      apps/reviewer/src/vendor/t3       browser components, synced from main
//   engine  apps/reviewer/vendor/t3-engine    the engine's API contracts the app uses, pinned to
//                                            the release tag of the T3 Code engine it talks to.
//                                            Its relative imports must all resolve inside the
//                                            tree, so `add` any module a synced file starts using.
//
//   node scripts/sync-t3.mjs check                  verify every tree == upstream(pin) + patches
//   node scripts/sync-t3.mjs patch                  regenerate patches from the current trees
//   node scripts/sync-t3.mjs diff [--tree t] [ref]  what changed upstream since the pin
//   node scripts/sync-t3.mjs sync [--tree t] [ref]  pull upstream at ref and merge
//   node scripts/sync-t3.mjs add [--tree t] <path>  track more upstream files at the pin
//
// `--tree` defaults to ui. The engine tree's ref is a release tag such as v0.0.46; syncing it
// also reports the `effect` version and the bundled `@t3code/t3-*` engine build the reviewer
// must install to match.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const noticesPath = join(root, 'apps/reviewer/THIRD_PARTY_NOTICES.md')
const reviewerPackagePath = join(root, 'apps/reviewer/package.json')
const cache = join(root, 'node_modules/.cache/t3code')

const TREES = {
  ui: {
    dir: 'apps/reviewer/src/vendor/t3',
    defaultRef: 'main',
    notice: { pattern: /pinned to commit `[0-9a-f]{40}`/, text: (commit) => `pinned to commit \`${commit}\`` },
  },
  engine: {
    dir: 'apps/reviewer/vendor/t3-engine',
    defaultRef: undefined,
    notice: {
      pattern: /engine contracts are pinned to `[^`]+` \(commit `[0-9a-f]{40}`\)/,
      text: (commit, ref) => `engine contracts are pinned to \`${ref}\` (commit \`${commit}\`)`,
    },
    matchesEffect: true,
    matchesEngineBuild: true,
    selfContained: true,
  },
}

const [command = 'check', ...rest] = process.argv.slice(2)
const { treeName, args } = parseTreeOption(rest)
const commands = { check, patch: writePatches, diff: showDiff, sync, add }
if (!(command in commands)) {
  console.error(`Unknown command "${command}". Use check, patch, diff, sync or add.`)
  process.exit(2)
}
await commands[command](args)

// ---------------------------------------------------------------------------
// Commands

async function check() {
  const failures = []
  for (const tree of allTrees()) failures.push(...checkTree(tree))
  if (failures.length > 0) {
    console.error('T3 vendor trees are out of step with their manifests:\n  ' + failures.join('\n  '))
    console.error('\nAfter editing a vendored file, run "pnpm t3:patch" to record the change.')
    process.exit(1)
  }
}

function checkTree(tree) {
  const { manifest } = tree
  ensureCommit(manifest.commit)
  const failures = []
  const expectedPatches = new Set()
  for (const path of trackedPaths(tree, manifest.commit)) {
    const pristine = upstreamFile(manifest.commit, path)
    if (pristine === null) {
      failures.push(`${tree.name}: ${path}: missing upstream at ${short(manifest.commit)}`)
      continue
    }
    const local = readLocal(tree, path)
    if (local === null) {
      failures.push(`${tree.name}: ${path}: missing locally; run "pnpm t3:sync --tree ${tree.name} ${short(manifest.commit)}"`)
      continue
    }
    const expected = unifiedDiff(path, pristine, local)
    if (expected) expectedPatches.add(patchPath(tree, path))
    if ((expected ?? '') !== (readIfExists(patchPath(tree, path)) ?? '')) {
      failures.push(`${tree.name}: ${path}: local changes differ from the recorded patch`)
    }
  }
  for (const stray of untrackedFiles(tree, manifest.commit)) {
    failures.push(`${tree.name}: ${stray}: not tracked by the manifest; remove it or list it as a shim`)
  }
  for (const stray of listPatches(tree.patchesDir).filter((path) => !expectedPatches.has(path))) {
    failures.push(`${tree.name}: ${relative(tree.vendor, stray)}: patch has no tracked file or no remaining changes`)
  }
  for (const shim of manifest.shims ?? []) {
    const local = readLocal(tree, shim.path)
    if (local === null) failures.push(`${tree.name}: ${shim.path}: shim is missing`)
    else if (shim.verbatimDeclarations) failures.push(...copiedDeclarationFailures(tree, shim, local))
  }
  if (tree.selfContained) failures.push(...unresolvedImports(tree))
  if (tree.matchesEffect) {
    const required = upstreamEffectVersion(manifest.commit)
    const installed = reviewerEffectVersion()
    if (required !== installed) {
      failures.push(`${tree.name}: apps/reviewer must depend on effect ${required} exactly (found ${installed ?? 'none'})`)
    }
  }
  if (tree.matchesEngineBuild) {
    const release = manifest.ref.replace(/^v/, '')
    for (const [name, version] of Object.entries(reviewerEngineBuilds())) {
      if (version !== release) failures.push(`${tree.name}: apps/reviewer must bundle ${name} ${release} exactly (found ${version})`)
    }
  }
  if (failures.length === 0) {
    console.log(`${tree.name}: matches upstream ${manifest.ref ?? short(manifest.commit)} plus ${expectedPatches.size} patch(es).`)
  }
  return failures
}

async function writePatches() {
  for (const tree of allTrees()) {
    const { manifest } = tree
    ensureCommit(manifest.commit)
    for (const stale of listPatches(tree.patchesDir)) unlinkSync(stale)
    let count = 0
    for (const path of trackedPaths(tree, manifest.commit)) {
      const pristine = upstreamFile(manifest.commit, path)
      const local = readLocal(tree, path)
      if (pristine === null || local === null) continue
      const diff = unifiedDiff(path, pristine, local)
      if (!diff) continue
      writeFile(patchPath(tree, path), diff)
      count += 1
      console.log(`recorded ${relative(root, patchPath(tree, path))}`)
    }
    removeEmptyDirs(tree.patchesDir)
    console.log(`${tree.name}: ${count} patch(es) recorded against ${short(manifest.commit)}.`)
  }
}

async function showDiff([ref]) {
  const tree = selectedTree()
  const target = resolveRef(ref ?? requireDefaultRef(tree))
  const { manifest } = tree
  console.log(`${tree.name}: upstream ${short(manifest.commit)}..${short(target)}\n`)
  const tracked = manifest.files.map((file) => file.path)
  console.log(git(['diff', '--stat', manifest.commit, target, '--', ...tracked]) || 'tracked files: no changes')
  const replaced = (manifest.shims ?? []).map((shim) => shim.replaces)
  if (replaced.length > 0) {
    console.log('\nModules replaced by shims:')
    console.log(git(['diff', '--stat', manifest.commit, target, '--', ...replaced]) || 'no changes')
  }
}

async function sync([ref]) {
  const tree = selectedTree()
  const { manifest } = tree
  const requested = ref ?? requireDefaultRef(tree)
  const target = resolveRef(requested)
  ensureCommit(manifest.commit)
  if (target === manifest.commit) console.log(`${tree.name}: already pinned to ${short(target)}.`)
  const before = new Set(trackedPaths(tree, manifest.commit))
  const after = new Set(trackedPaths(tree, target))
  const conflicts = []
  const missing = []
  for (const path of new Set([...before, ...after])) {
    const base = before.has(path) ? upstreamFile(manifest.commit, path) : null
    const next = after.has(path) ? upstreamFile(target, path) : null
    const local = readLocal(tree, path)
    if (next === null) {
      // Removed upstream. Drop an untouched copy; keep a locally changed one for review.
      if (local !== null && local === base) rmSync(join(tree.vendor, path))
      else if (local !== null) missing.push(path)
      continue
    }
    if (local === null || base === null || local === base) {
      writeLocal(tree, path, next)
      continue
    }
    if (next === base) continue
    const merged = mergeFile(path, local, base, next, manifest.commit)
    writeLocal(tree, path, merged.content)
    if (merged.conflicts) conflicts.push(path)
  }
  for (const shim of manifest.shims ?? []) {
    if (shim.verbatimDeclarations) {
      const { refreshed, removed } = refreshCopiedDeclarations(tree, shim, target)
      if (refreshed.length > 0) console.log(`shim ${shim.path}: refreshed ${refreshed.join(', ')} from upstream`)
      missing.push(...removed.map((name) => `${shim.path}: ${name} (copied declaration)`))
      continue
    }
    const stat = git(['diff', '--stat', manifest.commit, target, '--', shim.replaces])
    if (stat) console.log(`shim ${shim.path} replaces a module that changed upstream:\n${stat}`)
  }
  manifest.commit = target
  if (tree.name === 'engine') manifest.ref = requested
  writeManifest(tree)
  updateNotices(tree, target, requested)
  removeEmptyDirs(tree.vendor)
  if (tree.matchesEffect) {
    const required = upstreamEffectVersion(target)
    if (required !== reviewerEffectVersion())
      console.log(`Set apps/reviewer's effect dependency to exactly ${required}, then run pnpm install.`)
  }
  if (tree.matchesEngineBuild) {
    const release = requested.replace(/^v/, '')
    for (const [name, version] of Object.entries(reviewerEngineBuilds())) {
      if (version !== release) console.log(`Set apps/reviewer's ${name} optional dependency to exactly ${release}.`)
    }
  }
  if (missing.length > 0) console.error(`Removed upstream but changed locally (kept):\n  ${missing.join('\n  ')}`)
  if (conflicts.length > 0) {
    console.error(`Merge conflicts to resolve, then run "pnpm t3:patch":\n  ${conflicts.join('\n  ')}`)
    process.exit(1)
  }
  await writePatches()
  console.log(`${tree.name}: pinned to ${requested} (${short(target)}). Run the reviewer lint, test and build before committing.`)
}

async function add(paths) {
  const tree = selectedTree()
  const { manifest } = tree
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
    writeLocal(tree, path, content)
    manifest.files.push({ path })
    console.log(`added ${path}`)
  }
  manifest.files.sort((a, b) => a.path.localeCompare(b.path))
  writeManifest(tree)
}

// ---------------------------------------------------------------------------
// Trees and manifests

function parseTreeOption(argv) {
  const index = argv.indexOf('--tree')
  if (index === -1) return { treeName: undefined, args: argv }
  const name = argv[index + 1]
  if (!name || !(name in TREES)) {
    console.error(`--tree must be one of: ${Object.keys(TREES).join(', ')}`)
    process.exit(2)
  }
  return { treeName: name, args: [...argv.slice(0, index), ...argv.slice(index + 2)] }
}

function loadTree(name) {
  const config = TREES[name]
  const vendor = join(root, config.dir)
  const manifestPath = join(vendor, 'manifest.json')
  return {
    ...config,
    name,
    vendor,
    manifestPath,
    patchesDir: join(vendor, 'patches'),
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
  }
}

function allTrees() {
  return (treeName ? [treeName] : Object.keys(TREES)).map(loadTree)
}

function selectedTree() {
  return loadTree(treeName ?? 'ui')
}

function requireDefaultRef(tree) {
  if (tree.defaultRef) return tree.defaultRef
  console.error(`Give the ${tree.name} tree a release tag, e.g. "pnpm t3:sync --tree ${tree.name} v0.0.46".`)
  process.exit(2)
}

function writeManifest(tree) {
  writeFileSync(tree.manifestPath, JSON.stringify(tree.manifest, null, 2) + '\n')
}

/**
 * Every upstream path the tree tracks at `commit`. A file entry names one file; a directory
 * entry tracks all files under it, minus those matching its `exclude` suffixes.
 */
function trackedPaths(tree, commit) {
  return tree.manifest.files.flatMap((entry) => {
    if (!entry.directory) return [entry.path]
    const listed = git(['ls-tree', '-r', '--name-only', commit, '--', entry.path])
    return listed
      .split('\n')
      .filter(Boolean)
      .filter((path) => !(entry.exclude ?? []).some((suffix) => path.endsWith(suffix)))
  })
}

/** Local files in the tree, other than its manifest and patches, that the manifest does not account for. */
function untrackedFiles(tree, commit) {
  const accounted = new Set([...trackedPaths(tree, commit), ...shimPaths(tree)])
  return listFiles(tree.vendor)
    .filter((full) => full !== tree.manifestPath && !full.startsWith(tree.patchesDir + '/'))
    .map((full) => relative(tree.vendor, full))
    .filter((path) => !accounted.has(path))
}

function shimPaths(tree) {
  return (tree.manifest.shims ?? []).map((shim) => shim.path)
}

/** Relative imports in the tree's modules that do not resolve to a tracked file or shim. */
function unresolvedImports(tree) {
  const present = new Set([...trackedPaths(tree, tree.manifest.commit), ...shimPaths(tree)])
  const failures = []
  for (const path of present) {
    if (!/\.[cm]?tsx?$/.test(path)) continue
    const source = readLocal(tree, path) ?? ''
    for (const [, specifier] of source.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = join(dirname(path), specifier)
      if (!present.has(target)) {
        failures.push(`${tree.name}: ${path}: imports ${specifier}, which the tree does not track; run "pnpm t3:add --tree ${tree.name} ${target}"`)
      }
    }
  }
  return failures
}

/**
 * Top-level declarations of a module by name, as line ranges. A declaration runs from its keyword
 * at column 0 to the end of that line if it ends there, or else to the next line that starts
 * with a closing bracket, which is how prettier lays out upstream's modules.
 */
function topLevelDeclarations(source) {
  const lines = source.split('\n')
  const declarations = new Map()
  const keyword = /^(?:export\s+)?(?:declare\s+)?(?:const|let|class|function|interface|type|enum)\s+([A-Za-z_$][\w$]*)/
  for (let start = 0; start < lines.length; start += 1) {
    const name = keyword.exec(lines[start])?.[1]
    if (!name) continue
    let end = start
    if (!lines[start].trimEnd().endsWith(';')) {
      end = start + 1
      while (end < lines.length && !/^[)}\]]/.test(lines[end])) end += 1
    }
    declarations.set(name, { start, end, text: lines.slice(start, end + 1).join('\n') })
    start = end
  }
  return declarations
}

/** How a shim's copied declarations differ from those of the upstream module it replaces. */
function copiedDeclarationFailures(tree, shim, local) {
  const upstream = topLevelDeclarations(upstreamFile(tree.manifest.commit, shim.replaces) ?? '')
  const own = new Set(shim.ownDeclarations ?? [])
  const copies = topLevelDeclarations(local)
  const failures = []
  for (const name of own) {
    if (!copies.has(name)) failures.push(`${tree.name}: ${shim.path}: ${name} is listed in ownDeclarations but not declared`)
  }
  for (const [name, { text }] of copies) {
    if (own.has(name)) continue
    const original = upstream.get(name)
    if (!original) {
      failures.push(`${tree.name}: ${shim.path}: ${name} is not declared upstream; copy an upstream declaration or list it in ownDeclarations`)
    } else if (original.text !== text) {
      failures.push(`${tree.name}: ${shim.path}: ${name} differs from upstream's ${shim.replaces}`)
    }
  }
  return failures
}

/** Rewrites a shim's copied declarations from upstream at `commit`; reports those upstream dropped. */
function refreshCopiedDeclarations(tree, shim, commit) {
  const upstream = topLevelDeclarations(upstreamFile(commit, shim.replaces) ?? '')
  const own = new Set(shim.ownDeclarations ?? [])
  const lines = (readLocal(tree, shim.path) ?? '').split('\n')
  const copies = [...topLevelDeclarations(lines.join('\n'))].filter(([name]) => !own.has(name))
  const refreshed = []
  const removed = []
  for (const [name, { start, end, text }] of copies.reverse()) {
    const next = upstream.get(name)
    if (!next) removed.push(name)
    else if (next.text !== text) {
      lines.splice(start, end - start + 1, ...next.text.split('\n'))
      refreshed.push(name)
    }
  }
  writeLocal(tree, shim.path, lines.join('\n'))
  return { refreshed: refreshed.reverse(), removed: removed.reverse() }
}

function upstreamEffectVersion(commit) {
  const workspace = upstreamFile(commit, 'pnpm-workspace.yaml') ?? ''
  const catalog = workspace.slice(workspace.indexOf('\ncatalog:'))
  return /\n\s+effect:\s*["']?([^\s"']+)/.exec(catalog)?.[1] ?? null
}

/** The platform builds of the T3 Code engine the desktop app bundles, by package name. */
function reviewerEngineBuilds() {
  const pkg = JSON.parse(readFileSync(reviewerPackagePath, 'utf8'))
  return Object.fromEntries(Object.entries(pkg.optionalDependencies ?? {}).filter(([name]) => name.startsWith('@t3code/t3-')))
}

function reviewerEffectVersion() {
  const pkg = JSON.parse(readFileSync(reviewerPackagePath, 'utf8'))
  return pkg.dependencies?.effect ?? null
}

// ---------------------------------------------------------------------------
// Upstream access (blobless clone cached under node_modules)

function ensureClone() {
  if (existsSync(join(cache, '.git', 'HEAD'))) return
  rmSync(cache, { recursive: true, force: true })
  mkdirSync(dirname(cache), { recursive: true })
  const repository = loadTree('ui').manifest.repository
  console.log(`Cloning ${repository} (blobless) into ${relative(root, cache)}…`)
  execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', repository, cache], {
    stdio: 'inherit',
  })
}

function ensureCommit(commit) {
  ensureClone()
  if (hasCommit(commit)) return
  execFileSync('git', ['-C', cache, 'fetch', '--quiet', '--tags', 'origin'], { stdio: 'inherit' })
  if (!hasCommit(commit)) throw new Error(`Commit ${commit} is not reachable from upstream`)
}

/** Full commit id for a branch, tag or (abbreviated) commit, fetching from origin as needed. */
function resolveRef(ref) {
  ensureClone()
  const fetch = spawnSync('git', ['-C', cache, 'fetch', '--quiet', 'origin', ref], { encoding: 'utf8' })
  if (fetch.status === 0) return git(['rev-parse', 'FETCH_HEAD^{commit}'])
  execFileSync('git', ['-C', cache, 'fetch', '--quiet', '--tags', 'origin'], { stdio: 'inherit' })
  if (!hasCommit(ref)) throw new Error(`"${ref}" is not a branch, tag or commit upstream`)
  return git(['rev-parse', `${ref}^{commit}`])
}

function hasCommit(ref) {
  return spawnSync('git', ['-C', cache, 'cat-file', '-e', `${ref}^{commit}`]).status === 0
}

/** A file's content at `commit`, or null when the commit has no such file. */
function upstreamFile(commit, path) {
  const result = spawnSync('git', ['-C', cache, 'show', `${commit}:${path}`], { maxBuffer: 64 * 1024 * 1024 })
  if (result.status === 0) return result.stdout.toString('utf8')
  // The blobless clone fetches content on demand; a failed fetch must not read as a removed file.
  if (!git(['ls-tree', '--name-only', commit, '--', path])) return null
  throw new Error(`Could not read ${path} at ${short(commit)}: ${result.stderr}`)
}

function git(args) {
  return execFileSync('git', ['-C', cache, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

// ---------------------------------------------------------------------------
// Local tree, patches, merges

function readLocal(tree, path) {
  return readIfExists(join(tree.vendor, path))
}

function writeLocal(tree, path, content) {
  writeFile(join(tree.vendor, path), content)
}

function patchPath(tree, path) {
  return join(tree.patchesDir, `${path}.patch`)
}

function listPatches(dir) {
  return listFiles(dir).filter((path) => path.endsWith('.patch'))
}

function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full) : [full]
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

function mergeFile(path, local, base, next, baseCommit) {
  return withTempFiles({ local, base, next }, (files) => {
    const result = spawnSync(
      'git',
      ['merge-file', '-p', '-L', `local ${path}`, '-L', `upstream ${short(baseCommit)}`, '-L', 'upstream', files.local, files.base, files.next],
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

function updateNotices(tree, commit, ref) {
  const notices = readFileSync(noticesPath, 'utf8')
  const updated = notices.replace(tree.notice.pattern, tree.notice.text(commit, ref))
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
