import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  // Relative asset paths so the build works under a GitHub Pages subpath.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: { input: { main: 'index.html', rider: 'rider.html' } },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
