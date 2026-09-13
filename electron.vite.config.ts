import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The GitHub OAuth client ID is baked in at build time. It is a PUBLIC value —
 * the device flow needs no client secret, which is the whole reason it is the
 * flow we use — but process.env is not available in a packaged main bundle, so
 * it has to be substituted here rather than read at run time.
 */
const GITHUB_CLIENT_ID = process.env.VITE_GITHUB_CLIENT_ID || ''

export default defineConfig({
  main: {
    define: {
      'process.env.VITE_GITHUB_CLIENT_ID': JSON.stringify(GITHUB_CLIENT_ID)
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // module workers (sim engine lazy-imports ngspice-WASM inside a worker)
    worker: { format: 'es' },
    plugins: [react(), tailwindcss()]
  }
})
