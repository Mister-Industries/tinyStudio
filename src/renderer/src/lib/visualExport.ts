/**
 * Builds a self-contained HTML page from a project's visual.js p5 sketch.
 *
 * The export runs anywhere (open the file locally, or host it on GitHub Pages)
 * and keeps live USB serial via the Web Serial API — the same serialValue() /
 * serialEvent() shims the in-app Visual view provides, so the sketch is dropped
 * in unchanged. Every export carries a "Made with tinyStudio" credit linking to
 * tinycore.cc, so projects are discoverable and the tool gets attribution.
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
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
<style>
  :root { --navy-900:#070b22; --navy-800:#0a0f2d; --navy-700:#11173a; --navy-600:#1a1f4d;
    --navy-400:#353c78; --cyan:#00f0ff; --pink:#ff3f8c; --fg-1:#ffffff; --fg-3:rgba(214,220,255,.46); }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:22px; padding:32px 16px;
    background: radial-gradient(1200px 600px at 50% -10%, #141a44 0%, var(--navy-800) 55%, var(--navy-900) 100%);
    color: var(--fg-1); font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; }
  h1 { margin:0; font-size:22px; font-weight:700; letter-spacing:-0.01em; }
  .card { background: var(--navy-700); border:1px solid var(--navy-400); border-radius:16px;
    padding:18px; display:flex; flex-direction:column; align-items:center; gap:14px;
    box-shadow: 0 18px 50px rgba(0,0,0,.45); }
  #stage { display:flex; align-items:center; justify-content:center;
    background: var(--navy-900); border:1px solid var(--navy-600); border-radius:10px; overflow:hidden; }
  #stage canvas { display:block; max-width:100%; height:auto; border-radius:8px; }
  .row { display:flex; align-items:center; gap:12px; }
  button { font:inherit; font-weight:600; font-size:13px; cursor:pointer; border:none; border-radius:999px;
    padding:9px 18px; color:#04122b; background:var(--cyan); }
  button:disabled { opacity:.5; cursor:default; }
  .status { font-size:12px; color:var(--fg-3); font-family:'JetBrains Mono', ui-monospace, monospace; }
  .dot { width:8px; height:8px; border-radius:50%; background:#4a5296; display:inline-block; }
  .dot.on { background:#3ddc97; box-shadow:0 0 8px #3ddc97; }
  footer { font-size:13px; color:var(--fg-3); }
  footer a { color:var(--cyan); text-decoration:none; font-weight:600; }
  footer a:hover { text-decoration:underline; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <div class="card">
    <div id="stage"></div>
    <div class="row">
      <button id="connect">Connect device</button>
      <span class="status"><span class="dot" id="dot"></span> <span id="status">Not connected</span></span>
    </div>
  </div>
  <footer>Made with <a href="https://tinycore.cc" target="_blank" rel="noreferrer">tinyStudio</a></footer>

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
  var statusEl = document.getElementById('status');
  var dotEl = document.getElementById('dot');
  var connectBtn = document.getElementById('connect');
  function setStatus(text, on) { statusEl.textContent = text; dotEl.className = 'dot' + (on ? ' on' : ''); }

  if (!('serial' in navigator)) {
    setStatus('Web Serial unsupported — use Chrome or Edge', false);
    connectBtn.disabled = true;
  }

  connectBtn.onclick = async function () {
    try {
      var port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      setStatus('Connected', true);
      connectBtn.textContent = 'Connected';
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
      setStatus('Connection failed: ' + e.message, false);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect device';
    }
  };

  // ---- the user's sketch (p5 global mode) ----
  ${safeSketch}

  // route serial lines into the sketch's serialEvent(), if defined
  window.addEventListener('tinyserial', function (e) {
    if (typeof serialEvent === 'function') { try { serialEvent(e.detail.line); } catch (err) {} }
  });

  // p5 global mode appends the canvas to <body>; move it into the centered stage.
  new MutationObserver(function (muts, obs) {
    var c = document.querySelector('body > canvas');
    if (c) { document.getElementById('stage').appendChild(c); obs.disconnect(); }
  }).observe(document.body, { childList: true });
  </script>
</body>
</html>`
}
