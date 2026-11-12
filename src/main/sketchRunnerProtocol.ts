/**
 * Serves the Visual view's sketch runner over a private scheme in the packaged app.
 *
 * The runner (renderer/sketch-runner) runs in an iframe with
 * sandbox="allow-scripts", so it has an opaque origin. When the app is loaded from
 * file://, Chromium won't let an opaque-origin page load file:// URLs ("Not allowed
 * to load local resource"), so the runner page and its p5.min.js / runner.js never
 * loaded and the Visual view sat on "starting…" forever. Serving the same folder
 * as tinystudio-sketch://runner/… avoids the file:// rule without loosening the
 * sandbox: the sketch still can't reach the app, the project files or accounts.
 *
 * The dev server and the web app serve the runner over http and don't use this.
 * See docs/visual-default-plotter.md.
 */

import { net, protocol } from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'

export const SKETCH_SCHEME = 'tinystudio-sketch'

/** Must be called before the app's `ready` event. */
export function registerSketchScheme(): void {
  protocol.registerSchemesAsPrivileged([
    // standard: relative URLs (p5.min.js, runner.js) resolve like http.
    // secure: treated like https, so the page isn't "mixed content".
    { scheme: SKETCH_SCHEME, privileges: { standard: true, secure: true } }
  ])
}

/** Serve files from `runnerDir` only; anything outside it is a 404. Call once the app is ready. */
export function serveSketchRunner(runnerDir: string): void {
  const root = normalize(runnerDir)
  protocol.handle(SKETCH_SCHEME, (request) => {
    let file: string
    try {
      file = normalize(join(root, decodeURIComponent(new URL(request.url).pathname)))
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 })
    return net
      .fetch(pathToFileURL(file).href)
      .catch(() => new Response('Not found', { status: 404 }))
  })
}
