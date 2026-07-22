// web.vite.config.ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Absolute base so deep SPA routes (e.g. /owner/repo/path) still resolve
  // /assets/... correctly. A relative './' base would resolve assets against
  // the deep path and 404 once the Netlify SPA redirect serves index.html there.
  base: '/',
  // module workers (sim engine lazy-imports ngspice-WASM inside a worker)
  worker: { format: 'es' },
  build: {
    outDir: path.resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  },
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer/src')
    }
  }
})
