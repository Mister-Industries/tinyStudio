/**
 * Vite plugins shared by the desktop (electron-vite) and web renderer builds.
 *
 *   p5Runtime  serves and emits sketch-runner/p5.min.js from node_modules/p5,
 *              so the sandboxed Visual runner (public/sketch-runner) works
 *              offline without a 1 MB copy of p5 checked into the repo.
 *   devCsp     relaxes script-src on the dev server only: Vite injects an
 *              inline React Refresh preamble that the production policy in
 *              index.html rightly blocks.
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import type { Plugin } from 'vite' with { 'resolution-mode': 'import' }

const P5_ASSET = 'sketch-runner/p5.min.js'
const PROD_SCRIPT_SRC = "script-src 'self' 'wasm-unsafe-eval'"

let p5Code: string | null = null
function p5Source(): string {
  if (p5Code === null) {
    const resolve = createRequire(join(process.cwd(), 'package.json')).resolve
    p5Code = readFileSync(resolve('p5/lib/p5.min.js'), 'utf8')
  }
  return p5Code
}

export function p5Runtime(): Plugin {
  return {
    name: 'tinystudio-p5-runtime',
    configureServer(server) {
      server.middlewares.use(`/${P5_ASSET}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.end(p5Source())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: P5_ASSET, source: p5Source() })
    }
  }
}

export function devCsp(): Plugin {
  return {
    name: 'tinystudio-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(PROD_SCRIPT_SRC, `${PROD_SCRIPT_SRC} 'unsafe-inline' 'unsafe-eval'`)
    }
  }
}
