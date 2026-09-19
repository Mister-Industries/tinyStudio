/**
 * capture-agent-screens.mjs: refresh the screenshots bundled with Studio AI's
 * guides (src/shared/agentGuides/screens/). Run after UI changes that would
 * make them misleading.
 *
 *   npm run dev:web                                          (one terminal)
 *   npx electron scripts/capture-agent-screens.mjs [url]     (default http://localhost:5173)
 *
 * Drives the web build in a hidden Electron window:
 *   app-code.jpg          blink-basic example, Code view
 *   app-circuit.jpg       same project, Circuit view
 *   app-visual.jpg        an example without a visual.js, so the Visual view
 *                         seeds the default sketch, fed with test serial data
 *   visual-reference.jpg  the reference sketch from visual-js.md, rendered in
 *                         the app's light and dark tokens side by side
 *
 * tinycore-pinout.png is the official render from Mister-Industries/tinyCore
 * (assets/Renders/tinyCoreV2Pinout.png), not captured here.
 */

import { app, BrowserWindow, nativeImage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src/shared/agentGuides/screens')
const base = (process.argv.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:5173').replace(
  /\/$/,
  ''
)
const EXAMPLES = '/Mister-Industries/tinyStudio-examples/basics'
const WIDTH = 1280
const HEIGHT = 800

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(win, expr, timeout = 45000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await win.webContents.executeJavaScript(`!!(${expr})`).catch(() => false)) return
    await sleep(250)
  }
  throw new Error(`Timed out waiting for: ${expr}`)
}

function clickButton(win, label) {
  return win.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll('button, [role="tab"]')]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
    if (!el) throw new Error('No button labelled ' + ${JSON.stringify(label)})
    el.click()
  })()`)
}

async function save(image, file) {
  const sized =
    image.getSize().width > WIDTH ? image.resize({ width: WIDTH, quality: 'best' }) : image
  writeFileSync(join(outDir, file), sized.toJPEG(85))
  console.log(`wrote ${file}`, sized.getSize())
}

async function openExample(win, name) {
  await win.loadURL(`${base}${EXAMPLES}/${name}`)
  await waitFor(
    win,
    `document.querySelector('.monaco-editor') && document.body.innerText.includes('${name}.ino')`
  )
  await sleep(2000)
}

/** Serial test data: a slow wave with some wobble, like a light sensor. */
const FEED_SERIAL = `window.__feed = setInterval(() => {
  const t = Date.now() / 700;
  const v = Math.round(2048 + 1300 * Math.sin(t) + 280 * Math.sin(t * 3.7));
  const b = window.__tinySerial || (window.__tinySerial = { lines: [], values: [], last: '', value: 0 });
  b.lines = [...b.lines.slice(-300), String(v)];
  b.values = [...b.values.slice(-300), v];
  b.last = String(v);
  b.value = v;
}, 50)`

/** Render the visual-js guide's reference sketch in light and dark, side by side. */
function referenceSketchScript() {
  const guide = readFileSync(join(root, 'src/shared/agentGuides/visual-js.md'), 'utf8')
  const code = /## Reference sketch[\s\S]*?```js\n([\s\S]*?)```/.exec(guide)?.[1]
  if (!code) throw new Error('No reference sketch found in visual-js.md')
  const themeSrc = readFileSync(join(root, 'src/renderer/src/lib/sketchTheme.ts'), 'utf8')
  const tokens = Object.fromEntries(
    [
      .../SKETCH_THEME_TOKENS = \{([\s\S]*?)\}/.exec(themeSrc)[1].matchAll(/(\w+): '(--[\w-]+)'/g)
    ].map((m) => [m[1], m[2]])
  )

  return `(async () => {
    const root = document.documentElement;
    const was = root.className;
    const readTheme = (mode) => {
      root.classList.remove('light', 'dark');
      root.classList.add(mode);
      const css = getComputedStyle(root);
      const theme = { font: 'Plus Jakarta Sans', mono: 'Fira Code', dark: mode === 'dark' };
      for (const [k, v] of Object.entries(${JSON.stringify(tokens)})) theme[k] = css.getPropertyValue(v).trim();
      theme.series = ['blue', 'green', 'purple', 'red', 'yellow'].map((k) => theme[k]);
      return theme;
    };
    await document.fonts.ready;
    const render = (theme) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(host);
      const factory = new Function('p', 'theme', 'with(p){ function serialAvailable(){ return true; }\\n' +
        ${JSON.stringify(code)} +
        '\\n p.setup = setup; p.draw = draw; p.serialEvent = serialEvent; }');
      const inst = new window.p5((p) => {
        factory(p, theme);
        const setup = p.setup;
        p.setup = () => { p.pixelDensity(1); setup(); p.noLoop(); };
      }, host);
      inst.serialEvent('state:on');
      for (let i = 0; i < 120; i++) {
        inst.serialEvent(String(Math.round(2048 + 1300 * Math.sin(i / 9) + 280 * Math.sin(i / 2.4))));
      }
      for (let i = 0; i < 90; i++) inst.redraw();
      const canvas = host.querySelector('canvas');
      return { canvas, done: () => { inst.remove(); host.remove(); } };
    };
    const light = render(readTheme('light'));
    const dark = render(readTheme('dark'));
    root.className = was;
    const gap = 24;
    const out = document.createElement('canvas');
    out.width = 480 * 2 + gap * 3;
    out.height = 480 + gap * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#cfd5dc';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(light.canvas, gap, gap, 480, 480);
    ctx.drawImage(dark.canvas, gap * 2 + 480, gap, 480, 480);
    light.done();
    dark.done();
    return out.toDataURL('image/png');
  })()`
}

async function main() {
  // Offscreen rendering: a plain hidden window barely runs requestAnimationFrame,
  // so p5 sketches would draw only a few frames before the capture.
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  win.webContents.setFrameRate(60)

  // Light theme, as most users see it.
  await win.loadURL(base)
  await win.webContents.executeJavaScript(`localStorage.setItem('vite-ui-theme', 'light')`)

  await openExample(win, 'blink-basic')
  await save(await win.webContents.capturePage(), 'app-code.jpg')

  await clickButton(win, 'Circuit')
  await sleep(5000)
  await save(await win.webContents.capturePage(), 'app-circuit.jpg')

  await openExample(win, 'blink-external-led')
  await clickButton(win, 'Visual')
  await waitFor(win, `document.querySelector('canvas')`)
  await win.webContents.executeJavaScript(FEED_SERIAL)
  await sleep(6000)
  await save(await win.webContents.capturePage(), 'app-visual.jpg')

  const reference = await win.webContents.executeJavaScript(referenceSketchScript())
  await save(nativeImage.createFromDataURL(reference), 'visual-reference.jpg')
}

app.whenReady().then(() =>
  main()
    .then(() => app.quit())
    .catch((e) => {
      console.error(e)
      app.exit(1)
    })
)
