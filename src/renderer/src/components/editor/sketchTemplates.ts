/**
 * The visual.js every project starts with: a serial plotter in the style of the
 * Arduino IDE's, plus a strip of the latest raw lines like its Serial Monitor.
 * Documented in docs/visual-default-plotter.md.
 */
export const DEFAULT_VISUAL = `// visual.js: Serial Plotter
// Graphs every number the board prints, like the Arduino IDE's Serial Plotter,
// with the latest raw lines underneath like its Serial Monitor.
//
// Print one line per reading. Separate values with spaces, commas or tabs, and
// name them with label:value to get a labelled line each:
//   Serial.printf("temp:%.1f humidity:%.1f\\n", t, h);  // two named lines
//   Serial.println(analogRead(A5));                      // one line, "value 1"
// Lines with no numbers in them (like "Setup complete!") only show in the
// monitor strip. Colours come from \`theme\`, so it follows light and dark mode.
// Switch to Code to edit this sketch; Visual to run it.

const MAX_POINTS = 200; // samples kept on screen
const MONITOR_LINES = 5; // raw lines shown under the plot

let series = {}; // name -> values, oldest first (NaN = no value in that line)
let order = []; // series names, in the order they first appeared
let samples = 0; // data lines received
let recent = []; // latest raw lines, for the monitor strip

function setup() {
  createCanvas(480, 480);
  // pick up whatever arrived before the sketch started
  for (const line of serialLines()) addLine(line);
}

function serialEvent(line) {
  addLine(line);
}

// A field is a number when it is all number: "12", "-3.5", "1e3".
function isNumber(text) {
  return /^[-+]?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?$/.test(text);
}

// The Arduino Serial Plotter's rules: fields are split on spaces, commas and
// tabs; "label:value" (or "label: value") names a line, and an unnamed number
// becomes "value 1", "value 2", ... by its position.
function parseLine(line) {
  const fields = line.trim().split(/[\\s,]+/).filter((f) => f.length > 0);
  const out = [];
  let unnamed = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const colon = field.lastIndexOf(':');
    if (colon > 0 && colon < field.length - 1) {
      const value = field.slice(colon + 1);
      if (isNumber(value)) out.push([field.slice(0, colon), parseFloat(value)]);
    } else if (colon === field.length - 1 && i + 1 < fields.length) {
      if (isNumber(fields[i + 1])) {
        out.push([field.slice(0, -1), parseFloat(fields[i + 1])]);
        i++;
      }
    } else if (isNumber(field)) {
      unnamed++;
      out.push(['value ' + unnamed, parseFloat(field)]);
    }
  }
  return out;
}

function addLine(raw) {
  const line = String(raw).replace(/\\r/g, '');
  recent.push(line);
  if (recent.length > MONITOR_LINES) recent.shift();

  const values = parseLine(line);
  if (values.length === 0) return;
  for (const [name] of values) {
    if (!series[name]) {
      // a series that shows up late starts with gaps, so the lines stay aligned
      series[name] = new Array(Math.min(samples, MAX_POINTS)).fill(NaN);
      order.push(name);
    }
  }
  const latest = Object.fromEntries(values);
  for (const name of order) {
    const data = series[name];
    data.push(name in latest ? latest[name] : NaN);
    if (data.length > MAX_POINTS) data.shift();
  }
  samples++;
}

// theme.series has 5 colours; after that, fall back to text tones so a 6th
// line doesn't reuse the 1st line's colour.
function seriesColor(i) {
  const colours = theme.series.concat([theme.text, theme.muted]);
  return colours[i % colours.length];
}

// Short, steady labels: 1234, 12.3, 0.12
function fmt(n) {
  if (!isFinite(n)) return '-';
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function lastValue(data) {
  for (let i = data.length - 1; i >= 0; i--) if (!isNaN(data[i])) return data[i];
  return NaN;
}

// Cut text to fit \`w\` pixels with the current font.
function fit(text, w) {
  if (textWidth(text) <= w) return text;
  let s = text;
  while (s.length > 0 && textWidth(s + '…') > w) s = s.slice(0, -1);
  return s + '…';
}

function draw() {
  background(theme.bg);
  const pad = 20;

  // title + sample count
  noStroke();
  textFont(theme.font);
  textStyle(BOLD);
  textSize(13);
  textAlign(LEFT, TOP);
  fill(theme.muted);
  text('SERIAL PLOTTER', pad, pad);
  textFont(theme.mono);
  textStyle(NORMAL);
  textSize(11);
  textAlign(RIGHT, TOP);
  text(samples + (samples === 1 ? ' sample' : ' samples'), width - pad, pad + 1);

  // legend: a colour chip, the name and the latest value for each line
  let x = pad;
  let y = pad + 26;
  textSize(12);
  textAlign(LEFT, CENTER);
  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const label = name + ' ' + fmt(lastValue(series[name]));
    const w = 14 + textWidth(label) + 16;
    if (x + w > width - pad && x > pad) {
      x = pad;
      y += 20;
    }
    fill(seriesColor(i));
    rect(x, y - 5, 10, 10, 3);
    fill(theme.body);
    text(label, x + 14, y);
    x += w;
  }

  // plot card
  const monitorH = 30 + MONITOR_LINES * 16;
  const top = y + 18;
  const bottom = height - pad - monitorH - 12;
  const left = pad;
  const right = width - pad;
  stroke(theme.border);
  strokeWeight(1.5);
  fill(theme.panel);
  rect(left, top, right - left, bottom - top, 10);

  const plotL = left + 50;
  const plotR = right - 12;
  const plotT = top + 14;
  const plotB = bottom - 14;

  if (order.length === 0) {
    noStroke();
    fill(theme.muted);
    textFont(theme.font);
    textSize(14);
    textAlign(CENTER, CENTER);
    text('Waiting for numbers…', (left + right) / 2, (top + bottom) / 2 - 12);
    textFont(theme.mono);
    textSize(11);
    fill(theme.faint);
    text('print lines like  temp:21.5 humidity:40', (left + right) / 2, (top + bottom) / 2 + 12);
  } else {
    // range over everything on screen, with a little headroom
    let lo = Infinity;
    let hi = -Infinity;
    for (const name of order) {
      for (const v of series[name]) {
        if (isNaN(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const room = (hi - lo) * 0.08;
    hi += room;
    lo -= room;

    // grid + axis labels
    textFont(theme.mono);
    textSize(10);
    textAlign(RIGHT, CENTER);
    for (let i = 0; i <= 4; i++) {
      const gy = map(i, 0, 4, plotT, plotB);
      stroke(theme.grid);
      strokeWeight(1);
      line(plotL, gy, plotR, gy);
      noStroke();
      fill(theme.muted);
      text(fmt(map(i, 0, 4, hi, lo)), plotL - 8, gy);
    }
    // zero line, when zero is on screen
    if (lo < 0 && hi > 0) {
      const zy = map(0, lo, hi, plotB, plotT);
      stroke(theme.faint);
      strokeWeight(1);
      line(plotL, zy, plotR, zy);
    }

    // one line per series; a missing value breaks the line
    noFill();
    strokeWeight(2);
    for (let s = 0; s < order.length; s++) {
      const data = series[order[s]];
      stroke(seriesColor(s));
      let drawing = false;
      for (let i = 0; i < data.length; i++) {
        if (isNaN(data[i])) {
          if (drawing) endShape();
          drawing = false;
          continue;
        }
        if (!drawing) beginShape();
        drawing = true;
        vertex(map(i, 0, MAX_POINTS - 1, plotL, plotR), map(data[i], lo, hi, plotB, plotT));
      }
      if (drawing) endShape();
    }
  }

  // monitor strip: the latest raw lines, newest at the bottom
  const mTop = height - pad - monitorH;
  stroke(theme.border);
  strokeWeight(1.5);
  fill(theme.panel);
  rect(left, mTop, right - left, monitorH, 10);
  noStroke();
  textFont(theme.font);
  textStyle(BOLD);
  textSize(10);
  textAlign(LEFT, TOP);
  fill(theme.muted);
  text('SERIAL MONITOR', left + 12, mTop + 8);
  textFont(theme.mono);
  textStyle(NORMAL);
  textSize(11);
  if (recent.length === 0) {
    fill(theme.faint);
    text('No data yet', left + 12, mTop + 26);
  }
  for (let i = 0; i < recent.length; i++) {
    fill(i === recent.length - 1 ? theme.text : theme.body);
    text(fit(recent[i], right - left - 24), left + 12, mTop + 26 + i * 16);
  }
}
`

/** Starter p5.js sketch dropped into newly created .js files. */
export const sketchTemplate = (title: string): string => `// ${title}: p5.js sketch.
// Switch to Code to edit this sketch; Visual to run it.

let x = 240;
let y = 240;
let dx = 3;
let dy = 2;

function setup() {
  createCanvas(480, 480);
  noStroke();
}

function draw() {
  background(theme.bg);
  x += dx;
  y += dy;
  if (x < 20 || x > width - 20) dx = -dx;
  if (y < 20 || y > height - 20) dy = -dy;
  fill(theme.accent);
  circle(x, y, 40);
}
`
