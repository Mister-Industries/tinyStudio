// visual.js — a breathing LED that tracks the board's PWM brightness.
// tinyStudio feeds each Serial.println() line to serialEvent(); the sketch
// prints a 0–255 number per frame, so we parse it, glow a bulb in proportion,
// and scroll a brightness curve underneath. A small taste of p5.js + serial.

let brightness = 0; // latest 0–255 value from the board
let history = []; // recent brightness samples
const MAX = 240;

function setup() {
  createCanvas(420, 420);
  textFont('monospace');
}

function draw() {
  background(7, 11, 34);
  history.push(brightness);
  if (history.length > MAX) history.shift();

  const t = brightness / 255; // 0..1

  // ── glowing LED bulb ──
  const cx = width / 2;
  const cy = 138;
  noStroke();
  fill(255, 63, 140, 60 * t);
  circle(cx, cy, 210);
  fill(255, 63, 140, 40 * t);
  circle(cx, cy, 150);
  stroke(53, 60, 120);
  strokeWeight(2);
  fill(lerpColor(color(26, 31, 77), color(255, 63, 140), t));
  circle(cx, cy, 96);
  noStroke();
  fill(255);
  textAlign(CENTER);
  textSize(20);
  text(brightness, cx, cy + 7);

  // ── brightness curve ──
  stroke(53, 60, 120);
  line(20, 360, width - 20, 360);
  noFill();
  stroke(255, 63, 140);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < history.length; i++) {
    const x = map(i, 0, MAX, 20, width - 20);
    const y = map(history[i], 0, 255, 360, 230);
    vertex(x, y);
  }
  endShape();

  noStroke();
  fill(123, 134, 184);
  textAlign(LEFT);
  textSize(12);
  text('brightness', 20, 390);
}

// Called by tinyStudio for every line the board prints over serial.
function serialEvent(line) {
  const n = parseInt(line, 10);
  if (!isNaN(n)) brightness = constrain(n, 0, 255);
}
