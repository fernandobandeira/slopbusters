import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src/vendor/t3', import.meta.url)) } },
  test: { include: ['test/**/*.test.{ts,tsx}'] },
})
