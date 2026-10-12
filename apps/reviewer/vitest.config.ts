import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src/vendor/t3/apps/web/src', import.meta.url)),
      '@t3tools/shared': fileURLToPath(
        new URL('./src/vendor/t3/packages/shared/src', import.meta.url),
      ),
      '@t3tools/contracts': fileURLToPath(
        new URL('./vendor/t3-engine/packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: { include: ['test/**/*.test.{ts,tsx}'] },
})
