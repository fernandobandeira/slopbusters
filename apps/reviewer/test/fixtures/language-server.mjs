/* global process */
import { createMessageConnection } from 'vscode-jsonrpc/node.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
const connection = createMessageConnection(process.stdin, process.stdout)
let root
let document
let initialization
connection.onRequest('initialize', async (params) => {
  root = fileURLToPath(params.rootUri)
  initialization = params
  const settings = await connection.sendRequest('workspace/configuration', {
    items: [{ section: 'gopls' }, { section: 'rust-analyzer' }, { section: 'python.analysis' }],
  })
  writeFileSync(
    join(root, 'client-record.json'),
    JSON.stringify({ initialization, settings, pid: process.pid }),
  )
  return {
    capabilities: {
      definitionProvider: true,
      referencesProvider: true,
      implementationProvider: true,
      positionEncoding: 'utf-8',
    },
  }
})
connection.onNotification('textDocument/didOpen', ({ textDocument }) => {
  document = textDocument
})
function locations(params) {
  if (!document || document.uri !== params.textDocument.uri)
    throw new Error('Document must be opened first')
  const record = JSON.parse(readFileSync(join(root, 'client-record.json'), 'utf8'))
  writeFileSync(
    join(root, 'client-record.json'),
    JSON.stringify({ ...record, document, request: params }),
  )
  const extension = fileURLToPath(document.uri).split('.').at(-1)
  const uri = pathToFileURL(join(root, `service.${extension}`)).href
  return [
    {
      targetUri: uri,
      targetRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 99 } },
      targetSelectionRange: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } },
    },
    { uri, range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } } },
    {
      uri: pathToFileURL('/outside/snapshot.py').href,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    },
  ]
}
connection.onRequest('textDocument/definition', locations)
connection.onRequest('textDocument/references', locations)
connection.onRequest('textDocument/implementation', locations)
connection.onRequest('shutdown', () => null)
connection.onNotification('exit', () => process.exit(0))
connection.listen()
