/**
 * Builds a self-contained HTML page from a project's visual.js p5 sketch.
 *
 * The export runs anywhere (open the file locally, or host it on GitHub Pages)
 * and keeps live USB serial via the Web Serial API — the same serialValue() /
 * serialEvent() shims the in-app Visual view provides, so the sketch is dropped
 * in unchanged. It's framed like a little hosted device/minigame: a fixed square
 * screen with a titled header and a "Made with tinyStudio" credit linking to
 * tinycore.cc, so projects look professional and the tool gets attribution.
 */

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
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
<style>
  :root {
    --navy-1000:#05081a; --navy-900:#070b22; --navy-800:#0a0f2d; --navy-700:#11173a;
    --navy-600:#1a1f4d; --navy-500:#262c5e; --navy-400:#353c78;
    --cyan:#00f0ff; --pink:#ff3f8c; --fg-1:#fff; --fg-2:rgba(235,238,255,.72); --fg-3:rgba(214,220,255,.46);
    --grad: linear-gradient(45deg, var(--cyan), var(--pink));
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px;
    background: radial-gradient(1100px 560px at 50% -8%, #16204d 0%, var(--navy-800) 55%, var(--navy-900) 100%);
    color: var(--fg-1); font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .cabinet {
    width: min(92vw, 540px); background: linear-gradient(180deg, var(--navy-700), var(--navy-800));
    border: 1px solid var(--navy-400); border-radius: 20px; padding: 16px;
    box-shadow: 0 24px 70px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.04);
    display: flex; flex-direction: column; gap: 14px;
  }
  .bar { display: flex; align-items: center; gap: 12px; padding: 2px 4px; }
  .title { flex: 1; min-width: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.01em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .connect { font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--navy-400);
    background: var(--navy-600); color: var(--fg-1); border-radius: 999px; padding: 7px 14px; transition: .15s; }
  .connect:hover:not(:disabled) { background: var(--navy-500); }
  .connect:disabled { cursor: default; border-color: rgba(61,220,151,.4); color: #bff7df; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #4a5296; flex: none; }
  .dot.on { background: #3ddc97; box-shadow: 0 0 9px #3ddc97; }
  /* The "screen": a fixed square the sketch is letterboxed into. */
  .screen { position: relative; width: 100%; aspect-ratio: 1 / 1; border-radius: 14px;
    background: var(--navy-1000); border: 1px solid var(--navy-600);
    box-shadow: inset 0 0 0 1px rgba(0,240,255,.06), inset 0 18px 60px rgba(0,0,0,.5); overflow: hidden; }
  .screen::before { content: ''; position: absolute; inset: 0; border-radius: 14px; pointer-events: none;
    box-shadow: inset 0 1px 0 rgba(0,240,255,.14); }
  #stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  #stage canvas { max-width: 100%; max-height: 100%; width: auto !important; height: auto !important; border-radius: 8px; }
  .credit { text-align: center; font-size: 12px; color: var(--fg-3); padding-top: 2px; }
  .credit a { font-weight: 700; text-decoration: none; background: var(--grad);
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .credit a:hover { text-decoration: underline; -webkit-text-fill-color: var(--cyan); }
  .spark { color: var(--cyan); }
</style>
</head>
<body>
  <main class="cabinet">
    <div class="bar">
      <div class="title">${title}</div>
      <button class="connect" id="connect"><span class="dot" id="dot"></span><span id="label">Connect</span></button>
    </div>
    <div class="screen"><div id="stage"></div></div>
    <div class="credit">Made with <span class="spark">✦</span> <a href="https://tinycore.cc" target="_blank" rel="noreferrer">tinyStudio</a></div>
  </main>

  <script>
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

  // ---- Web Serial connection (works on https / GitHub Pages and local file) ----
  var dotEl = document.getElementById('dot');
  var labelEl = document.getElementById('label');
  var connectBtn = document.getElementById('connect');
  function setStatus(text, on) { labelEl.textContent = text; dotEl.className = 'dot' + (on ? ' on' : ''); }

  if (!('serial' in navigator)) {
    setStatus('Use Chrome/Edge', false);
    connectBtn.disabled = true;
  }

  connectBtn.onclick = async function () {
    try {
      var port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      setStatus('Connected', true);
      connectBtn.disabled = true;
      var decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
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
    } catch (e) {
      setStatus('Connect', false);
      connectBtn.disabled = false;
    }
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
