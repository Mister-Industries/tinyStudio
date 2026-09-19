# visual.js: sketches for the Visual view

A project's `visual.js` is a p5.js sketch that turns the board's serial output into something to look at: a gauge, a chart, a game, a mirror of an LED. The attached screenshots show:
1. the Visual view with a sketch running;
2. the reference sketch below, in the app's light and dark themes.

## How it runs

- **p5.js 1.9.4**, loaded by the app. Write normal global-mode p5 (`function setup()`, `function draw()`). tinyStudio wraps the code so those globals work, and runs it right inside the app page.
- These functions are picked up if you define them:
  - `preload`, `setup`, `draw`
  - `mousePressed`, `mouseReleased`, `mouseClicked`, `mouseMoved`, `mouseDragged`, `mouseWheel`, `doubleClicked`
  - `keyPressed`, `keyReleased`, `keyTyped`
  - `touchStarted`, `touchMoved`, `touchEnded`
  - `windowResized`
  - `serialEvent`
- The sketch restarts from scratch every time the file changes, and when the user presses **Restart**. Nothing persists between runs.
- A thrown error stops the sketch and shows "Sketch error: …" in the view.
- **No `import`/`require`, no npm packages.** In the desktop app, loading URLs is blocked by the content security policy: no `loadImage('https://…')`, no `fetch`/`loadJSON` from other sites. Draw everything with code.
- The same file runs unchanged in the exported standalone page. Use only p5, the serial helpers and `theme`; don't reach into `window.__tinySerial` or other app internals.

## Canvas

The Visual view shows the canvas in a **square** frame, scaled to fit. The export does the same. Use a square canvas: `createCanvas(480, 480)`. Other shapes are letterboxed. Don't size it from `windowWidth`/`windowHeight`: those measure the whole app window, not the frame.

## Serial helpers (built in)

| helper | returns |
| --- | --- |
| `serialEvent(line)` | define it: called once for every line received, in order, just before `draw()` |
| `serialValue()` | the first number in the latest line (see the serial guide for the exact rule) |
| `serialValues()` | array of those numbers for the last 300 lines |
| `serialLines()` | array of the last 300 raw lines |
| `serialRead()` / `serialReadLine()` | the latest raw line (`''` before any arrive) |
| `serialAvailable()` | `true` once any line has arrived |

- Use `serialValue()` only when the board prints **one plain number per line**.
- For anything else (labels, several values, events) parse in `serialEvent(line)`.
- The exact parsing rules and good line formats are in `read_guide("serial")`.

## `theme`: use it for every colour and font

`theme` is built in and always current. When the user switches the app between light and dark mode, the same fields change value on the next frame, with no restart. Never hard-code colours.

| field | use for |
| --- | --- |
| `theme.bg` | `background()` every frame |
| `theme.panel` | cards and chart areas sitting on the background |
| `theme.grid` | grid lines, axis ticks, dividers |
| `theme.border` | outlines of cards, bars and controls |
| `theme.text` | primary text and big readouts |
| `theme.body` | normal text |
| `theme.muted` | labels, units, captions |
| `theme.faint` | disabled / inactive, minor ticks |
| `theme.accent` | the main data series, active state, highlights (tinyStudio blue) |
| `theme.series` | array of distinct colours for multiple series: `theme.series[i % theme.series.length]` |
| `theme.green` / `theme.red` / `theme.yellow` | on / OK, off / alert, warning |
| `theme.blue` / `theme.purple` | extra accents |
| `theme.font` | `textFont(theme.font)`: UI font (Plus Jakarta Sans) for titles and labels |
| `theme.mono` | `textFont(theme.mono)`: Fira Code for numbers and readouts |
| `theme.dark` | `true` in dark mode, if a drawing needs to adjust |

Colours are CSS strings, so `fill(theme.accent)` works directly. For transparency:

```js
const glow = color(theme.accent);
glow.setAlpha(50);
fill(glow);
```

## The tinyStudio look

Visuals should feel like part of the app: calm, flat and legible.

- **Flat.** Solid fills on `theme.bg`, cards in `theme.panel` with a `theme.border` outline (`strokeWeight(1.5)`), rounded corners (`rect(x, y, w, h, 10)`). No gradients, neon glows, drop shadows or dark navy backgrounds.
- **One accent.** Most of the canvas is neutral; `theme.accent` marks the data that matters. Use `theme.green`/`theme.red` only for meaning (on/off, OK/alert).
- **Clear hierarchy.**
  - A small bold label top-left: `textFont(theme.font)`, `textStyle(BOLD)`, size 12–14, `theme.muted`, uppercase.
  - A big readout: `theme.mono`, size 48–72, `theme.text`.
  - Units in `theme.muted`.
- **Breathing room.** Keep 24–32 px padding from the canvas edge, and align things to it.
- **Smooth, not jumpy.** Ease displayed numbers toward the latest reading (`shown = lerp(shown, target, 0.15)`), and keep chart lines 2–3 px thick.
- **Readable at a glance.** Label what's shown and its units. Show an empty state ("waiting for serial…") before the first line arrives.

Older examples use navy backgrounds with pink/cyan. That's the retired look. When asked to touch one of those sketches, restyle it with `theme`.

## Reference sketch

This is the sketch in the second screenshot. It pairs with an `.ino` that prints one reading per line (`Serial.println(analogRead(A5));`), plus `state:on` / `state:off` lines.

```js
// visual.js: light sensor dashboard (tinyStudio reference style)

const MAX = 120;  // samples kept in the chart
let history = [];
let latest = 0;
let shown = 0;    // eased readout
let on = false;

function setup() {
  createCanvas(480, 480);
}

function draw() {
  background(theme.bg);
  const pad = 28;

  // label
  noStroke();
  fill(theme.muted);
  textFont(theme.font);
  textStyle(BOLD);
  textSize(13);
  textAlign(LEFT, TOP);
  text('LIGHT SENSOR', pad, pad);

  // status pill
  const pillW = 64;
  const pill = color(on ? theme.green : theme.faint);
  pill.setAlpha(45);
  fill(pill);
  rect(width - pad - pillW, pad - 5, pillW, 26, 13);
  fill(on ? theme.green : theme.muted);
  textAlign(CENTER, CENTER);
  textSize(12);
  text(on ? 'ON' : 'OFF', width - pad - pillW / 2, pad + 8);

  // big readout
  shown = lerp(shown, latest, 0.15);
  fill(theme.text);
  textFont(theme.mono);
  textStyle(NORMAL);
  textAlign(LEFT, TOP);
  textSize(64);
  text(serialAvailable() ? Math.round(shown) : '-', pad, pad + 28);
  fill(theme.muted);
  textFont(theme.font);
  textSize(13);
  text(serialAvailable() ? 'raw ADC · 0–4095' : 'waiting for serial…', pad, pad + 104);

  // chart card
  const top = 170;
  const w = width - pad * 2;
  const h = height - top - pad;
  fill(theme.panel);
  stroke(theme.border);
  strokeWeight(1.5);
  rect(pad, top, w, h, 10);

  stroke(theme.grid);
  strokeWeight(1);
  for (let i = 1; i < 4; i++) {
    const y = top + (h * i) / 4;
    line(pad + 14, y, pad + w - 14, y);
  }

  noFill();
  stroke(theme.accent);
  strokeWeight(2.5);
  beginShape();
  history.forEach((v, i) => {
    const x = map(i, 0, MAX - 1, pad + 14, pad + w - 14);
    const y = map(v, 0, 4095, top + h - 14, top + 14, true);
    vertex(x, y);
  });
  endShape();
}

// one line per reading, plus "state:on" / "state:off"
function serialEvent(line) {
  const t = line.trim();
  if (/^state:on$/i.test(t)) on = true;
  else if (/^state:off$/i.test(t)) on = false;
  else if (!isNaN(parseFloat(t))) {
    latest = parseFloat(t);
    history.push(latest);
    if (history.length > MAX) history.shift();
  }
}
```

## Checklist before handing a visual back

- The `.ino` prints exactly what `serialEvent` / `serialValue()` expects (same labels, separators, value ranges).
- Every colour and font comes from `theme`.
- The canvas is square, and the sketch has an empty state before data arrives.
- Arrays are capped (`shift()` past a maximum); nothing grows forever.
- Tell the user to **Upload** the `.ino` (if it changed) and switch to **Visual**.
