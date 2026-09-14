/**
 * Builds a self-contained HTML page from a project's visual.js p5 sketch.
 *
 * The export runs anywhere (open the file locally, or host it on GitHub Pages)
 * and keeps live USB serial via the Web Serial API — the same serialValue() /
 * serialEvent() shims the in-app Visual view provides, so the sketch is dropped
 * in unchanged, with the same `theme` object (lib/sketchTheme) read from this
 * page's own copy of the tokens. It's dressed in the tinyStudio design system (tokens copied
 * from assets/base.css): a card on the notebook dot-grid with a titled bar
 * holding a light/dark toggle and a tactile Connect key, a square screen the
 * sketch is letterboxed into, and a footer with the connection status and a
 * "Made with tinyStudio" credit linking to tinystudio.cc. It follows the viewer's
 * OS theme until they pick one.
 */

import { sketchThemeScript } from './sketchTheme'

// Semantic tokens from assets/base.css, trimmed to what the page uses. Keep in
// sync with the app when the palette changes.
const LIGHT_TOKENS = `
    color-scheme: light;
    --bg:#fafbfc; --bg-sunken:#edf0f3; --bg-raised:#ffffff; --surface-card:#ffffff;
    --text-strong:#181a1e; --text-body:#24272c; --text-muted:#79818c; --text-faint:#a3abb5;
    --border-soft:#e3e7ec; --border-default:#cfd5dc; --border-interactive:#a3abb5;
    --brand:#42a5f5; --brand-deep:#1e88e5; --brand-soft:#dceefd;
    --blue:#42a5f5; --green:#2fa46a; --yellow:#f3cb00; --red:#e5544b; --purple:#9d5fd6; --idle:#a3abb5;
    --highlight-top: inset 0 1px 0 0 rgba(255,255,255,.45);
    --shadow-soft-sm: 0 2px 6px rgba(20,19,16,.1);
    --shadow-soft: 0 8px 24px rgba(20,19,16,.14);
    --dot-color: rgba(24,26,30,.09);`

const DARK_TOKENS = `
    color-scheme: dark;
    --bg:#2b2d31; --bg-sunken:#1e1f22; --bg-raised:#313338; --surface-card:#383a40;
    --text-strong:#f2f3f5; --text-body:#dbdee1; --text-muted:#969ba3; --text-faint:#6b7077;
    --border-soft:#26282c; --border-default:#26282b; --border-interactive:#4a4d54;
    --brand:#42a5f5; --brand-deep:#2a8fdb; --brand-soft:#16314a;
    --blue:#42a5f5; --green:#46c586; --yellow:#f5d426; --red:#f26d63; --purple:#b47ee8; --idle:#6b7077;
    --highlight-top: inset 0 1px 0 0 rgba(255,255,255,.12);
    --shadow-soft-sm: 0 2px 6px rgba(0,0,0,.4);
    --shadow-soft: 0 8px 24px rgba(0,0,0,.5);
    --dot-color: rgba(242,243,245,.07);`

// lucide icons (moon, sun), inlined so the page has no icon dependency.
const svg = (body: string, cls = ''): string =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const MOON = svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', 'i-moon')
const SUN = svg(
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'i-sun'
)

export function buildVisualExportHtml(projectName: string, sketchCode: string): string {
  const title = (projectName || 'tinyStudio sketch').replace(/[<>&]/g, '')
  // Neutralize any stray </script> in user code so it can't break out of the tag.
  const safeSketch = sketchCode.replace(/<\/script>/gi, '<\\/script>')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · tinyStudio</title>
<script>
  // Resolve the theme before first paint: the viewer's saved choice, else the OS.
  (function () {
    var t = null;
    try { t = localStorage.getItem('tinystudio-theme'); } catch (e) {}
    if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  })();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
<style>
  :root {${LIGHT_TOKENS}
    --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --font-mono: 'Fira Code', ui-monospace, 'SF Mono', Menlo, monospace;
    --ease-snap: cubic-bezier(.2,.8,.2,1);
  }
  :root[data-theme="dark"] {${DARK_TOKENS}
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding-block: 24px; padding-inline: 16px;
    background-color: var(--bg);
    background-image: radial-gradient(var(--dot-color) 1.1px, transparent 1.1px);
    background-size: 18px 18px; background-position: -1px -1px;
    color: var(--text-body); font-family: var(--font-sans); -webkit-font-smoothing: antialiased;
  }

  /* The card — the same raised panel + 1.5px border the app's panels use. */
  .device {
    width: min(100%, 560px); background: var(--bg-raised);
    border: 1.5px solid var(--border-default); border-radius: 12px;
    box-shadow: var(--shadow-soft); overflow: hidden;
  }
  .bar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px;
    padding: 12px 14px; border-bottom: 1.5px solid var(--border-default);
  }
  .heading { flex: 1 1 180px; min-width: 0; }
  .title {
    margin: 0; font-size: 17px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-strong);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .actions { display: flex; align-items: center; gap: 8px; }

  /* Connection status — a dot + label, like the app's status bar. */
  .status {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; color: var(--text-muted);
  }
  .dot { position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--idle); flex: none; }
  .status[data-state="ok"] .dot { background: var(--green); }
  .status[data-state="warn"] .dot { background: var(--yellow); }
  .status[data-state="ok"] .dot::after {
    content: ''; position: absolute; inset: 0; border-radius: 50%; background: inherit;
    animation: pulse 1.6s cubic-bezier(.16,1,.3,1) infinite;
  }
  @keyframes pulse { 0% { transform: scale(1); opacity: .6; } 70%, 100% { transform: scale(2.6); opacity: 0; } }

  /* Tactile keys — a top highlight over a solid bottom edge; lift on hover, press down on click. */
  .btn {
    font: inherit; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap;
    height: 30px; padding: 0 12px; display: inline-flex; align-items: center;
    border: 0; border-radius: 5px; cursor: pointer;
    transition: transform 110ms var(--ease-snap), box-shadow 110ms var(--ease-snap), filter 110ms var(--ease-snap);
  }
  .btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn-primary {
    background: var(--brand); color: #fff;
    box-shadow: var(--highlight-top), 0 2px 0 0 var(--brand-deep), 0 4px 10px rgba(20,19,16,.16);
  }
  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px); filter: brightness(1.04);
    box-shadow: var(--highlight-top), 0 3px 0 0 var(--brand-deep), 0 7px 16px rgba(20,19,16,.2);
  }
  .btn-primary:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: var(--highlight-top), 0 0 0 0 var(--brand-deep), 0 1px 3px rgba(20,19,16,.18);
  }
  /* Theme toggle — a chromeless icon, like the one in the Studio's top bar. */
  .theme-toggle {
    width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 5px; background: transparent; color: var(--text-muted); cursor: pointer;
    transition: color 110ms var(--ease-snap), background-color 110ms var(--ease-snap);
  }
  .theme-toggle:hover { color: var(--text-strong); background: var(--bg-sunken); }
  .theme-toggle:active { transform: translateY(1px); }
  .theme-toggle:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  .theme-toggle svg { width: 16px; height: 16px; }
  .i-sun { display: none; }
  :root[data-theme="dark"] .i-sun { display: block; }
  :root[data-theme="dark"] .i-moon { display: none; }

  /* The screen: a fixed square the sketch is letterboxed into, as in the Visual view. */
  .stage-wrap { padding: 16px; background: var(--bg-sunken); }
  .screen {
    position: relative; width: 100%; max-width: 100%; aspect-ratio: 1 / 1; overflow: hidden;
    background: var(--bg-raised); border: 1.5px solid var(--border-default); border-radius: 8px;
    box-shadow: var(--shadow-soft-sm);
  }
  #stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  #stage canvas { width: 100% !important; height: 100% !important; object-fit: contain; }

  .foot {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px;
    padding: 10px 14px; border-top: 1.5px solid var(--border-default);
  }
  .credit { font-size: 12px; color: var(--text-muted); text-decoration: none; border-radius: 5px; }
  .credit:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  .wordmark { font-size: 13px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-strong); transition: color 110ms; }
  .wordmark span { font-weight: 500; color: var(--text-muted); }
  .credit:hover .wordmark { color: var(--brand); }

  @media (prefers-reduced-motion: reduce) {
    .btn, .theme-toggle, .wordmark { transition: none; }
    .status .dot::after { animation: none; }
  }
</style>
</head>
<body>
  <main class="device">
    <header class="bar">
      <div class="heading">
        <h1 class="title">${title}</h1>
      </div>
      <div class="actions">
        <button class="theme-toggle" id="theme" type="button" aria-label="Switch theme" title="Switch theme">${MOON}${SUN}</button>
        <button class="btn btn-primary" id="connect" type="button">Connect</button>
      </div>
    </header>
    <div class="stage-wrap"><div class="screen"><div id="stage"></div></div></div>
    <footer class="foot">
      <span class="status" id="status" data-state="idle" role="status"><span class="dot"></span><span id="status-text">Not connected</span></span>
      <a class="credit" href="https://tinystudio.cc" target="_blank" rel="noreferrer">Made with <span class="wordmark"><span>tiny</span>Studio</span></a>
    </footer>
  </main>

  <script>
  // ---- light / dark toggle (follows the OS until the viewer picks one) ----
  var rootEl = document.documentElement;
  var themeBtn = document.getElementById('theme');
  function isDark() { return rootEl.getAttribute('data-theme') === 'dark'; }
  function labelTheme() {
    var label = isDark() ? 'Light mode' : 'Dark mode';
    themeBtn.setAttribute('aria-label', label); themeBtn.title = label;
  }
  themeBtn.onclick = function () {
    var next = isDark() ? 'light' : 'dark';
    rootEl.setAttribute('data-theme', next);
    try { localStorage.setItem('tinystudio-theme', next); } catch (e) {}
    labelTheme();
  };
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      var saved = null;
      try { saved = localStorage.getItem('tinystudio-theme'); } catch (err) {}
      if (!saved) { rootEl.setAttribute('data-theme', e.matches ? 'dark' : 'light'); labelTheme(); }
    });
  } catch (e) {}
  labelTheme();

  // ---- serial bus + Processing-style shims (match the tinyStudio Visual view) ----
  window.__tinySerial = { lines: [], values: [], last: '', value: 0 };
  function __pushSerial(line) {
    var m = String(line).match(/-?\\d+(?:\\.\\d+)?/);
    var value = m ? parseFloat(m[0]) : (/(HIGH|\\bON\\b|true)/i.test(line) ? 1 : 0);
    var b = window.__tinySerial;
    b.lines.push(line); if (b.lines.length > 300) b.lines.shift();
    b.values.push(value); if (b.values.length > 300) b.values.shift();
    b.last = line; b.value = value;
    try { window.dispatchEvent(new CustomEvent('tinyserial', { detail: { line: line, value: value } })); } catch (e) {}
  }
  function serialRead() { return window.__tinySerial.last; }
  function serialReadLine() { return window.__tinySerial.last; }
  function serialAvailable() { return window.__tinySerial.lines.length > 0; }
  function serialValue() { return window.__tinySerial.value; }
  function serialValues() { return window.__tinySerial.values.slice(); }
  function serialLines() { return window.__tinySerial.lines.slice(); }

  // ---- theme: design tokens for the sketch, kept current across the light/dark toggle ----
  ${sketchThemeScript()}

  // ---- Web Serial connection (works on https / GitHub Pages and local file) ----
  var statusEl = document.getElementById('status');
  var statusText = document.getElementById('status-text');
  var connectBtn = document.getElementById('connect');
  function setStatus(state, text) { statusEl.setAttribute('data-state', state); statusText.textContent = text; }

  if (!('serial' in navigator)) {
    setStatus('warn', 'Use Chrome or Edge');
    connectBtn.disabled = true;
    connectBtn.title = 'Live serial needs Web Serial (Chrome or Edge)';
  }

  connectBtn.onclick = async function () {
    var port = null;
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      setStatus('ok', 'Connected');
      connectBtn.hidden = true;
      var decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable).catch(function () {});
      var reader = decoder.readable.getReader();
      var buf = '';
      while (true) {
        var r = await reader.read();
        if (r.done) break;
        buf += r.value;
        var parts = buf.split(/\\r?\\n/);
        buf = parts.pop();
        for (var i = 0; i < parts.length; i++) if (parts[i]) __pushSerial(parts[i]);
      }
    } catch (e) {}
    // Picker cancelled, board unplugged, or stream ended — back to idle.
    if (port) { try { await port.close(); } catch (e) {} }
    setStatus('idle', 'Not connected');
    connectBtn.hidden = false;
  };

  // ---- the user's sketch (p5 global mode) ----
  ${safeSketch}

  // route serial lines into the sketch's serialEvent(), if defined
  window.addEventListener('tinyserial', function (e) {
    if (typeof serialEvent === 'function') { try { serialEvent(e.detail.line); } catch (err) {} }
  });

  // p5 global mode appends the canvas to <body>; keep moving it into the framed
  // screen until it lands there (covers timing + canvas recreation).
  function placeCanvas() {
    var c = document.querySelector('canvas');
    var stage = document.getElementById('stage');
    if (c && stage && c.parentElement !== stage) stage.appendChild(c);
  }
  new MutationObserver(placeCanvas).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', placeCanvas);
  var __t = 0, __iv = setInterval(function () { placeCanvas(); if (++__t > 30) clearInterval(__iv); }, 100);
  </script>
</body>
</html>`
}
