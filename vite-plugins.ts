/**
 * Vite plugins shared by the desktop (electron-vite) and web renderer builds.
 *
 *   p5Runtime       serves and emits sketch-runner/p5.min.js from node_modules/p5,
 *                   so the sandboxed Visual runner (public/sketch-runner) works
 *                   offline without a 1 MB copy of p5 checked into the repo.
 *   devCsp          relaxes script-src on the dev server only: Vite injects an
 *                   inline React Refresh preamble that the production policy in
 *                   index.html rightly blocks.
 *   githubTokenDev  runs netlify/functions/github-token.ts on the web dev server,
 *                   so browser GitHub sign-in works on localhost without a
 *                   deploy. The client secret comes from .env.local or the
 *                   environment (docs/github-auth.md).
 */

import { existsSync, readFileSync } from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
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

const TOKEN_FUNCTION_PATH = '/.netlify/functions/github-token'
const TOKEN_FUNCTION_FILE = 'netlify/functions/github-token.ts'

/**
 * GITHUB_CLIENT_SECRET from .env.local in the repo root. Read on every request,
 * so creating, changing or deleting the file needs no dev server restart.
 */
function secretFromEnvLocal(): string | undefined {
  const file = join(process.cwd(), '.env.local')
  if (!existsSync(file)) return undefined
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*GITHUB_CLIENT_SECRET\s*=/.test(l))
  const value = line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
  return value || undefined
}

/**
 * GITHUB_CLIENT_SECRET as the dev server's process was started with. Captured
 * once per process, before the plugin first sets it: Vite re-evaluates this file
 * on every config reload, so a module-level copy would pick up our own value.
 */
function shellSecret(): string | undefined {
  const g = globalThis as { __tinystudioShellGithubSecret?: string }
  g.__tinystudioShellGithubSecret ??= process.env.GITHUB_CLIENT_SECRET ?? ''
  return g.__tinystudioShellGithubSecret || undefined
}

/** The Node request as the Web `Request` a Netlify function takes. */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0
  return new Request(`http://${req.headers.host ?? 'localhost'}${TOKEN_FUNCTION_PATH}`, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function githubTokenDev(): Plugin {
  return {
    name: 'tinystudio-github-token-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(TOKEN_FUNCTION_PATH, (req, res) => {
        const handle = async (): Promise<void> => {
          const secret = secretFromEnvLocal() || shellSecret()
          // The function reads the secret from its environment, as on Netlify.
          // Set it on every request so the current .env.local always wins.
          if (secret) process.env.GITHUB_CLIENT_SECRET = secret
          else delete process.env.GITHUB_CLIENT_SECRET
          if (!secret && req.method !== 'OPTIONS') {
            sendJson(res, 500, {
              error:
                'The dev server has no GitHub client secret. Add GITHUB_CLIENT_SECRET=… to .env.local in the tinyStudio folder, then sign in again.'
            })
            return
          }
          const fn = (await server.ssrLoadModule(join(process.cwd(), TOKEN_FUNCTION_FILE))) as {
            default: (request: Request) => Promise<Response>
          }
          const response = await fn.default(await toRequest(req))
          res.statusCode = response.status
          response.headers.forEach((value, name) => res.setHeader(name, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        }
        handle().catch((e: unknown) => {
          server.config.logger.error(
            `[github-token] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`
          )
          if (res.headersSent) res.end()
          else
            sendJson(res, 500, {
              error:
                "The dev server's sign-in function failed. See the terminal running npm run dev:web."
            })
        })
      })
    }
  }
}
