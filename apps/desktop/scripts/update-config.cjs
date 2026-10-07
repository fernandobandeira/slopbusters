const { writeFile } = require('node:fs/promises')
const { join } = require('node:path')

/**
 * electron-builder writes the updater feed only for dmg and zip targets, but
 * releases sign and notarize a --dir build first. Write the feed before signing
 * so every packaged app can check for updates.
 */
exports.default = async function writeUpdateConfig(context) {
  if (context.electronPlatformName !== 'darwin') return
  await writeFile(
    join(context.packager.getResourcesDir(context.appOutDir), 'app-update.yml'),
    updateConfig(context.packager.config.publish, context.packager.appInfo.updaterCacheDirName),
  )
}

function updateConfig({ provider, owner, repo }, updaterCacheDirName) {
  if (provider !== 'github' || !owner || !repo) throw new Error('Configure the GitHub release feed.')
  return Object.entries({ owner, repo, provider, updaterCacheDirName })
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`)
    .join('')
}

exports.updateConfig = updateConfig
