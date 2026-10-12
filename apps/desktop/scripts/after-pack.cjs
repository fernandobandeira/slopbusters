const { existsSync } = require('node:fs')
const { cp } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const writeUpdateConfig = require('./update-config.cjs').default

/** Runs before signing: write the update feed and add the bundled T3 Code engine. */
exports.default = async function afterPack(context) {
  await writeUpdateConfig(context)
  await copyEngine(context)
}

/**
 * electron-builder drops node_modules from extra resources, and the engine loads its native
 * modules from there, so copy its build as is. Its files keep T3's signature (see signIgnore).
 */
async function copyEngine(context) {
  const engine = resolve(__dirname, '../dist/t3-engine')
  if (!existsSync(engine)) return
  await cp(engine, join(context.packager.getResourcesDir(context.appOutDir), 't3-engine'), {
    recursive: true,
  })
}
