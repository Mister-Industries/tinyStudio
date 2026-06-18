// visual.js — live p5.js mirror of the board's LED, driven by serial.
// tinyStudio feeds each Serial.println() line to serialEvent(); this lights a
// virtual LED on "On" and dims it on "Off", echoing the latest serial line.

let on = false;
let lastLine = '—';

function setup() {
  createCanvas(520, 300);
  textFont('monospace');
}

function draw() {
  background(7, 11, 34);

  // virtual LED
  const cx = width / 2;
  const cy = 130;
  if (on) {
    noStroke();
    fill(255, 63, 140, 60);
    circle(cx, cy, 150); // glow halo
  }
  stroke(53, 60, 120);
  strokeWeight(2);
  fill(on ? color(255, 63, 140) : color(26, 31, 77));
  circle(cx, cy, 70);

  // labels
  noStroke();
  fill(0, 240, 255);
  textSize(20);
  textAlign(CENTER);
  text(on ? 'ON' : 'OFF', cx, cy + 7);

  fill(235, 238, 255, 180);
  textSize(13);
  text('serial: ' + lastLine, cx, height - 40);
}

// fired by tinyStudio for every serial line received
function serialEvent(line) {
  if (!line) return;
  lastLine = line.trim();
  if (/^on$/i.test(lastLine)) on = true;
  else if (/^off$/i.test(lastLine)) on = false;
}
