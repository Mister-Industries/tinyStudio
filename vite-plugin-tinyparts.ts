/**
 * vite-plugin-tinyparts — dev servers only: serve a tinyparts checkout live.
 *
 * With the tinyparts repo cloned next to this one (or TINYPARTS_DIR pointing at
 * it), `npm run dev` and `npm run dev:web` load the bundled and installed parts
 * packs straight from that folder, and push a change event the moment any file
 * in it is saved — Illustrator included — so the Circuit view reloads the art
 * without a restart or `npm run parts:sync`. The app side is
 * src/renderer/src/circuit/parts/devFolder.ts. None of this exists in a build.
 *
 * Endpoints, same origin as the app:
 *   GET    /__tinyparts/info            { root }
 *   GET    /__tinyparts/events          Server-Sent Events, one { paths } per batch of changes
 *   GET    /__tinyparts/file?path=      file text (404 if missing)
 *   GET    /__tinyparts/exists?path=    true | false
 *   GET    /__tinyparts/list?path=      [{ name, isDirectory }]
 *   PUT    /__tinyparts/file?path=      write (packs/…/*.json|*.svg only) — the Parts editor's "Save to tinyparts"
 *   DELETE /__tinyparts/file?path=      delete (packs/…/*.json only)
 */

import { existsSync, watch, type FSWatcher } from 'fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises'
import type { IncomingMessage, ServerResponse } from 'http'
import { dirname, join, relative, resolve, sep } from 'path'
// this file compiles as CommonJS (tsconfig.node, nodenext): take Vite's ESM types
import type { Plugin } from 'vite' with { 'resolution-mode': 'import' }

function send(res: ServerResponse, status: number, body: string, type = 'application/json'): void {
  res.statusCode = status
  res.setHeader('Content-Type', `${type}; charset=utf-8`)
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let text = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => (text += chunk))
    req.on('end', () => ok(text))
    req.on('error', fail)
  })
}

export function tinypartsDev(): Plugin {
  return {
    name: 'tinyparts-dev',
    apply: 'serve',
    configureServer(server) {
      const root = resolve(process.env.TINYPARTS_DIR || join(process.cwd(), '..', 'tinyparts'))
      const log = server.config.logger
      if (!existsSync(join(root, 'index.json'))) {
        log.info(
          `  tinyparts: no checkout at ${root} — parts come from the bundled snapshot (set TINYPARTS_DIR to use one)`
        )
        return
      }
      log.info(`  tinyparts: serving parts live from ${root}`)

      // ── change feed ────────────────────────────────────────────────────────
      const clients = new Set<ServerResponse>()
      let pending = new Set<string>()
      let timer: NodeJS.Timeout | null = null
      let watcher: FSWatcher | null = null
      try {
        watcher = watch(root, { recursive: true }, (_event, file) => {
          if (!file) return
          const rel = file.toString().replace(/\\/g, '/')
          if (rel === '.git' || rel.startsWith('.git/')) return
          pending.add(rel)
          // editors save through temp files and renames: send one batch
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            const message = `data: ${JSON.stringify({ paths: [...pending] })}\n\n`
            pending = new Set()
            for (const res of clients) res.write(message)
          }, 250)
        })
      } catch (e) {
        log.warn(`  tinyparts: can't watch ${root} (${String(e)}) — reload the page to see changes`)
      }
      server.httpServer?.once('close', () => {
        watcher?.close()
        for (const res of clients) res.end()
      })

      /** repo-relative path → absolute path, or null if it escapes the checkout */
      const locate = (raw: string): { abs: string; rel: string } | null => {
        const abs = resolve(root, raw)
        if (abs !== root && !abs.startsWith(root + sep)) return null
        return { abs, rel: relative(root, abs).replace(/\\/g, '/') }
      }

      server.middlewares.use('/__tinyparts', (req, res, next) => {
        void (async () => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const target = locate(url.searchParams.get('path') ?? '')
          try {
            switch (`${req.method} ${url.pathname}`) {
              case 'GET /info':
                return send(res, 200, JSON.stringify({ root }))
              case 'GET /events':
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-store',
                  Connection: 'keep-alive'
                })
                res.write(': connected\n\n')
                clients.add(res)
                req.on('close', () => clients.delete(res))
                return
              case 'GET /file':
                if (!target) return send(res, 400, '"path escapes the checkout"')
                return send(res, 200, await readFile(target.abs, 'utf8'), 'text/plain')
              case 'GET /exists':
                return send(res, 200, JSON.stringify(!!target && existsSync(target.abs)))
              case 'GET /list': {
                if (!target) return send(res, 400, '"path escapes the checkout"')
                const items = await readdir(target.abs, { withFileTypes: true })
                return send(
                  res,
                  200,
                  JSON.stringify(items.map((d) => ({ name: d.name, isDirectory: d.isDirectory() })))
                )
              }
              case 'PUT /file':
                if (!target || !/^packs\/[^/]+\/.+\.(json|svg)$/.test(target.rel))
                  return send(res, 403, '"only packs/<pack>/…/*.json and *.svg can be written"')
                await mkdir(dirname(target.abs), { recursive: true })
                await writeFile(target.abs, await readBody(req), 'utf8')
                return send(res, 200, 'true')
              case 'DELETE /file':
                if (!target || !/^packs\/[^/]+\/.+\.json$/.test(target.rel))
                  return send(res, 403, '"only packs/<pack>/…/*.json can be deleted"')
                await unlink(target.abs)
                return send(res, 200, 'true')
              default:
                return next()
            }
          } catch (e) {
            const code = (e as NodeJS.ErrnoException).code
            send(res, code === 'ENOENT' ? 404 : 500, JSON.stringify({ error: String(e) }))
          }
        })()
      })
    }
  }
}
