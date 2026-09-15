// web.vite.config.ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { tinypartsDev } from './vite-plugin-tinyparts'
import { devCsp, githubTokenDev, p5Runtime } from './vite-plugins'

export default defineConfig({
  // tinypartsDev: dev server only — serves ../tinyparts live (docs/parts-and-art.md).
  // githubTokenDev: dev server only — runs the GitHub sign-in token exchange locally.
  plugins: [react(), tailwindcss(), tinypartsDev(), p5Runtime(), devCsp(), githubTokenDev()],
  // GitHub sign-in overrides (lib/githubWebAuth); the app's own id is the default.
  define: {
    __GITHUB_CLIENT_ID__: JSON.stringify(process.env.VITE_GITHUB_CLIENT_ID || ''),
    __GITHUB_TOKEN_ENDPOINT__: JSON.stringify(process.env.VITE_GITHUB_TOKEN_ENDPOINT || '')
  },
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
