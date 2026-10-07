const { appendFileSync, mkdirSync, renameSync, statSync } = require('node:fs')
const { dirname } = require('node:path')

const MAX_LOG_BYTES = 1024 * 1024

/** A bounded file logger for electron-updater; the previous log is kept as .old. */
function createUpdateLog(path) {
  const write = (level, parts) => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      if (size(path) > MAX_LOG_BYTES) renameSync(path, `${path}.old`)
      const text = parts.map((part) => part instanceof Error ? part.stack ?? part.message : String(part)).join(' ')
      appendFileSync(path, `${new Date().toISOString()} [${level}] ${text}\n`, { mode: 0o600 })
    } catch {
      /* Logging must never break update checks. */
    }
  }
  return {
    info: (...parts) => write('info', parts),
    warn: (...parts) => write('warn', parts),
    error: (...parts) => write('error', parts),
    debug: (...parts) => write('debug', parts),
  }
}

function size(path) {
  try { return statSync(path).size } catch { return 0 }
}

module.exports = { createUpdateLog }
