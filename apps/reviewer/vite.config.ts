import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

export default defineConfig({
  publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
  plugins: [
    react(),
    tailwind(),
    {
      name: 't3-license-notice',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'bob-skill.md',
          source: ['SKILL.md', 'references/checklist.md', 'references/examples.md']
            .map((file) =>
              readFileSync(new URL(`../../skills/unclebob/${file}`, import.meta.url), 'utf8'),
            )
            .join('\n\n'),
        })
        this.emitFile({
          type: 'asset',
          fileName: 'linus-skill.md',
          source: ['SKILL.md', 'references/review-only.md']
            .map((file) =>
              readFileSync(new URL(`../../skills/linus/${file}`, import.meta.url), 'utf8'),
            )
            .join('\n\n'),
        })
        this.emitFile({
          type: 'asset',
          fileName: 'jobs-skill.md',
          source: ['SKILL.md', 'references/review-only.md']
            .map((file) =>
              readFileSync(new URL(`../../skills/jobs/${file}`, import.meta.url), 'utf8'),
            )
            .join('\n\n'),
        })
        this.emitFile({
          type: 'asset',
          fileName: 'T3_CODE_LICENSE.txt',
          source: readFileSync(new URL('./src/vendor/t3/LICENSE', import.meta.url), 'utf8'),
        })
        for (const [name, sourcePath] of [
          ['THEME_LICENSE.txt', './src/vendor/themes/LICENSE'],
          ['THEME_NOTICES.txt', './src/vendor/themes/NOTICE'],
        ] as const) {
          this.emitFile({
            type: 'asset',
            fileName: name,
            source: readFileSync(new URL(sourcePath, import.meta.url), 'utf8'),
          })
        }
      },
    },
  ],
  resolve: { alias: { '~': fileURLToPath(new URL('./src/vendor/t3', import.meta.url)) } },
  server: { port: 4310, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4311' } },
})
