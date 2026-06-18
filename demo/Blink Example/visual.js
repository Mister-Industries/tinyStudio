// visual.js — mirrors the board's LED and charts its On/Off history.
// tinyStudio feeds each Serial.println() line to serialEvent(); this lights a
// glowing bulb on "On" / dims it on "Off", and scrolls a square-wave timeline
// of the recent state underneath. A little taste of what p5.js + serial can do.

let on = false;
let history = []; // recent 1/0 samples
const MAX = 180;

function setup() {
  createCanvas(420, 420);
  textFont('monospace');
}

function draw() {
  background(7, 11, 34);
  history.push(on ? 1 : 0);
  if (history.length > MAX) history.shift();

  // ── glowing LED bulb ──
  const cx = width / 2;
  const cy = 138;
  if (on) {
    noStroke();
    fill(255, 63, 140, 55);
    circle(cx, cy, 210);
    fill(255, 63, 140, 35);
    circle(cx, cy, 150);
  }
  stroke(53, 60, 120);
  strokeWeight(2);
  fill(on ? color(255, 63, 140) : color(26, 31, 77));
  circle(cx, cy, 96);
  noStroke();
  fill(on ? 255 : 120);
  textAlign(CENTER);
  textSize(22);
  text(on ? 'ON' : 'OFF', cx, cy + 8);

  // latest serial line
  fill(0, 240, 255);
  textAlign(LEFT);
  textSize(13);
  const last = window.__tinySerial ? window.__tinySerial.last : '—';
  text('serial: ' + (last || '—'), 22, 28);

  // ── scrolling square-wave timeline ──
  const top = 264;
  const bot = 384;
  const left = 22;
  const right = width - 22;
  stroke(26, 31, 77);
  strokeWeight(1);
  line(left, top, right, top);
  line(left, bot, right, bot);

  noFill();
  stroke(0, 240, 255);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < history.length; i++) {
    const x = map(i, 0, MAX - 1, left, right);
    const y = history[i] ? top + 8 : bot - 8;
    vertex(x, y);
  }
  endShape();

  noStroke();
  fill(120, 130, 170);
  textSize(11);
  text('HIGH', left, top - 6);
  text('LOW', left, bot + 16);
}

// fired by tinyStudio for every serial line received
function serialEvent(line) {
  if (!line) return;
  const t = line.trim();
  if (/^on$/i.test(t)) on = true;
  else if (/^off$/i.test(t)) on = false;
}
