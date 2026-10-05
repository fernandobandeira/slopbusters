const { mkdtemp, mkdir, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { WorkspaceTypeScriptNavigation } = require('../../reviewer/server/adapters/workspaceNavigation.ts')

async function verifyWorkspaceWorker(options) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'slopbusters-worker-smoke-')))
  const files = new Map([
    ['tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@source/*":["src/*"]}}}'],
    ['src/use.ts', "import { run } from '@source/service'\nrun()\n"],
    ['src/service.ts', 'export function run() { return 42 }\n'],
  ])
  const sha = 'b'.repeat(40)
  const project = { tree: async () => ({ sha, paths: [...files.keys()], warnings: [] }) }
  const workspaces = { acquire: async () => ({ workspace: { directory, sha, paths: new Set(files.keys()), warnings: [] }, release() {} }) }
  const navigation = new WorkspaceTypeScriptNavigation(project, workspaces, options)
  try {
    const standardLibrary = await readFile(join(options.typeScriptLibDirectory, 'lib.es5.d.ts'), 'utf8')
    if (!standardLibrary.includes('interface Array<T>')) throw new Error('Packaged TypeScript standard declarations are missing.')
    for (const [path, content] of files) {
      await mkdir(join(directory, path, '..'), { recursive: true })
      await writeFile(join(directory, path), content)
    }
    const result = await navigation.navigate({ owner: 'example', repo: 'demo' }, { side: 'RIGHT', path: 'src/use.ts', line: 2, column: 1, kind: 'definition' })
    if (result.source?.kind !== 'local' || result.targets[0]?.path !== 'src/service.ts') throw new Error('Packaged full-project TypeScript navigation failed.')
    return { workspaceWorker: true }
  } finally { await navigation.close(); await rm(directory, { recursive: true, force: true }) }
}

module.exports = { verifyWorkspaceWorker }
