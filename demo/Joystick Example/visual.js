// visual.js — Qwiic Joystick X/Y grid visualizer
// Plots the joystick's live position on a grid to match what the sketch streams.
// The sketch prints one CSV line per sample:  x,y,button   (x,y in 0..1023)
//
//   serialRead()  -> latest raw line, e.g. "512,498,0"
//   serialLines() -> recent raw lines (used to draw the trail)

const RANGE = 1023;       // 10-bit ADC full scale
const PAD = 46;           // grid margin
let px = 512, py = 512;   // last good position (rest = centered)
let pressed = false;

function setup() {
  createCanvas(440, 440);
  textFont('monospace');
}

// parse "x,y,button" -> {x,y,b} or null if the line has no numbers
function parseLine(s) {
  let m = String(s).match(/(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*(\d+))?/);
  if (!m) return null;
  return { x: int(m[1]), y: int(m[2]), b: m[3] ? int(m[3]) : 0 };
}

// joystick -> screen. Physical stick grows LEFT in X and UP in Y
// (matching the SparkFun hookup directions), so X is inverted.
function sx(x) { return map(x, RANGE, 0, PAD, width - PAD); }
function sy(y) { return map(y, 0, RANGE, height - PAD, PAD); }

function draw() {
  background(0, 0, 0);

  let p = parseLine(serialRead());
  if (p) { px = p.x; py = p.y; pressed = p.b === 1; }

  drawGrid();

  // trail of recent samples
  let lines = serialLines();
  noFill();
  stroke(0, 240, 255, 90);
  strokeWeight(2);
  beginShape();
  for (let i = max(0, lines.length - 60); i < lines.length; i++) {
    let q = parseLine(lines[i]);
    if (q) vertex(sx(q.x), sy(q.y));
  }
  endShape();

  let gx = sx(px), gy = sy(py);

  // crosshair through the live point
  stroke(38, 48, 92);
  strokeWeight(1);
  line(PAD, gy, width - PAD, gy);
  line(gx, PAD, gx, height - PAD);

  // the joystick dot (glows gold while the button is pressed)
  noStroke();
  let r = pressed ? 26 : 18;
  fill(255, 63, 140, 60);
  circle(gx, gy, r + 16);
  fill(pressed ? color(255, 215, 0) : color(255, 63, 140));
  circle(gx, gy, r);

  drawReadout(gx, gy);
}

function drawGrid() {
  stroke(26, 34, 70);
  strokeWeight(1);
  const cells = 8;
  for (let i = 0; i <= cells; i++) {
    let x = map(i, 0, cells, PAD, width - PAD);
    let y = map(i, 0, cells, PAD, height - PAD);
    line(x, PAD, x, height - PAD);
    line(PAD, y, width - PAD, y);
  }
  // center cross — the ~512,512 rest position
  stroke(58, 70, 120);
  strokeWeight(1.5);
  let cx = sx(512), cy = sy(512);
  line(cx - 8, cy, cx + 8, cy);
  line(cx, cy - 8, cx, cy + 8);
}

function drawReadout() {
  noStroke();
  textSize(12);
  fill(150, 162, 196);
  textAlign(LEFT, TOP);
  text('Qwiic Joystick', 12, 12);
  fill(0, 240, 255);
  textAlign(RIGHT, TOP);
  text('X ' + nf(px, 4) + '   Y ' + nf(py, 4), width - 12, 12);
  fill(pressed ? color(255, 215, 0) : color(90, 100, 140));
  textAlign(RIGHT, BOTTOM);
  text(pressed ? '\u25CF BUTTON' : '\u25CB button', width - 12, height - 12);
}

// fires on every new serial line (kept for parity with the harness)
function serialEvent(line) {}