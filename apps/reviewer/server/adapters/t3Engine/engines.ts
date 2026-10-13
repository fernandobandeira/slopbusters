import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { BundledEngine } from './bundledEngine'
import { EngineChatHosts, type BundledEngineHost } from './chatHosts'
import { EngineConnection, type EngineCredentials } from './engineConnection'
import { pairWithEngine } from './enginePairing'
import { EngineThreads } from './engineThreads'
import { EngineTurns } from './engineTurns'

export interface BundledEngineSettings {
  /** The `t3` executable; development builds find it in node_modules. */
  readonly executable?: string
  /** Show a page of the bundled engine's web app; the default opens the browser. */
  readonly openUrl?: (url: string) => Promise<void>
}

/**
 * The engines chats can run on: the user's T3 Code, found through its home, and the engine
 * Slopbusters bundles, kept under the reviewer's data directory. Structured turns always run on
 * the bundled engine, so they never appear in the user's T3 Code.
 */
export function createChatHosts(options: {
  credentials: EngineCredentials
  dataDirectory: string
  bundled?: BundledEngineSettings
}) {
  const user = new EngineThreads(new EngineConnection({ credentials: options.credentials }))
  const executable = options.bundled?.executable ?? installedEngineExecutable()
  const home = join(options.dataDirectory, 't3-engine')
  const engine = executable ? new BundledEngine({ executable, home }) : undefined
  const connection = engine && bundledConnection(engine, options.credentials)
  const bundled: BundledEngineHost | undefined = engine &&
    connection && {
      engine,
      connection,
      threads: new EngineThreads(connection),
      home,
      openUrl: options.bundled?.openUrl,
    }
  return {
    hosts: new EngineChatHosts({ threads: user }, bundled),
    /** The bundled engine's connection, undefined when this build does not include it. */
    bundledConnection: connection,
    turns: connection && new EngineTurns(connection),
    close: () => engine?.close() ?? Promise.resolve(),
  }
}

function bundledConnection(engine: BundledEngine, credentials: EngineCredentials) {
  return new EngineConnection({
    credentials,
    locate: () => engine.ensureRunning(),
    pair: (running) => pairWithEngine(running, { cli: engine.cli() }),
  })
}

/** The platform build of `t3` that the reviewer's dependencies install, if there is one. */
function installedEngineExecutable(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require.resolve(`@t3code/t3-${process.platform}-${process.arch}/package.json`)
    return join(dirname(manifest), process.platform === 'win32' ? 't3.exe' : 't3')
  } catch {
    return undefined
  }
}
