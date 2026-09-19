import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tinypartsDev } from './vite-plugin-tinyparts'
import { devCsp, p5Runtime } from './vite-plugins'
import { GITHUB_CLIENT_ID_DEFAULT } from './src/shared/githubApp'

/**
 * The GitHub OAuth client ID is baked in at build time. It is a PUBLIC value:
 * the device flow needs no client secret, which is the whole reason it is the
 * flow we use, but process.env is not available in a packaged main bundle, so
 * it has to be substituted here rather than read at run time. The tinyStudio
 * app's own id is the default; VITE_GITHUB_CLIENT_ID overrides it.
 */
const GITHUB_CLIENT_ID = process.env.VITE_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID_DEFAULT

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
    // The desktop renderer never runs the web sign-in, but shares its code.
    define: {
      __GITHUB_CLIENT_ID__: JSON.stringify(GITHUB_CLIENT_ID),
      __GITHUB_TOKEN_ENDPOINT__: JSON.stringify('')
    },
    // module workers (sim engine lazy-imports ngspice-WASM inside a worker)
    worker: { format: 'es' },
    // tinypartsDev: dev server only; serves ../tinyparts live (docs/parts-and-art.md)
    plugins: [react(), tailwindcss(), tinypartsDev(), p5Runtime(), devCsp()]
  }
})
