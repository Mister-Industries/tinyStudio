/** The visual.js every project starts with: a serial plotter. */
export const DEFAULT_VISUAL = `// visual.js: Serial Plotter
// Graphs the latest number printed over Serial (serialValue()) as a scrolling
// line, auto-scaling to the data. Try Serial.println(analogRead(A5)) on the
// board. Colours come from \`theme\`, so the plot follows light and dark mode.
// Switch to Code to edit this sketch; Visual to run it.

let data = [];
const MAX = 240; // points kept on screen

function setup() {
  createCanvas(480, 480);
}

function draw() {
  background(theme.bg);
  const pad = 28;

  // pull the most recent serial value each frame
  data.push(serialValue());
  if (data.length > MAX) data.shift();

  // auto-scale to the data range (with a little headroom)
  let lo = Math.min(...data, 0);
  let hi = Math.max(...data, 1);
  if (hi === lo) hi = lo + 1;

  // label + latest value
  noStroke();
  fill(theme.muted);
  textFont(theme.font);
  textStyle(BOLD);
  textSize(13);
  textAlign(LEFT, TOP);
  text('SERIAL PLOTTER', pad, pad);
  fill(theme.text);
  textFont(theme.mono);
  textStyle(NORMAL);
  textSize(40);
  text(serialAvailable() ? serialValue().toFixed(2) : '-', pad, pad + 24);

  // grid + range labels
  const top = 130;
  const bottom = height - pad;
  const left = pad + 40;
  const right = width - pad;
  stroke(theme.grid);
  strokeWeight(1);
  for (let i = 0; i <= 4; i++) {
    const y = map(i, 0, 4, top, bottom);
    line(left, y, right, y);
  }
  noStroke();
  fill(theme.muted);
  textSize(11);
  textAlign(RIGHT, CENTER);
  text(hi.toFixed(0), left - 8, top);
  text(lo.toFixed(0), left - 8, bottom);

  // plotted line
  noFill();
  stroke(theme.accent);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < data.length; i++) {
    vertex(map(i, 0, MAX - 1, left, right), map(data[i], lo, hi, bottom, top));
  }
  endShape();
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
