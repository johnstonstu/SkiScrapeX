import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  // Relative asset paths so the build works under a GitHub Pages subpath.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    // three.js alone is about 560 kB minified (143 kB gzipped); nothing to split further.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: { main: 'index.html', rider: 'rider.html' },
      // three.js in its own chunk: it changes rarely, so returning players keep it cached.
      output: { manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined) },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
