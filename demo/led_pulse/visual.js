// visual.js — live p5.js preview of the sketch's serial output.
// tinyStudio feeds each Serial.println() line to serialEvent() and tracks the
// latest numeric value via serialValue(). Open the Visual view to watch it.

let pulse = 0;

function setup() {
  createCanvas(520, 300);
  textFont('monospace');
}

function draw() {
  background(7, 11, 34);

  // fade the pulse triggered by incoming serial lines
  pulse *= 0.92;

  noStroke();
  fill(235, 238, 255, 160);
  textSize(12);
  text('serial:', 24, 36);

  // moving indicator dot driven by the latest serial value
  const v = serialValue();
  const x = map(v % 100, 0, 100, 40, width - 40);
  fill(255, 63, 140);
  circle(x, height - 40, 18 + pulse * 30);

  fill(0, 240, 255);
  textSize(14);
  text('value: ' + v, 24, height - 70);
  text('samples: ' + serialValues().length, 160, height - 70);

  // glow ring scaled by the pulse
  noFill();
  stroke(0, 240, 255, 120);
  strokeWeight(2);
  circle(width / 2, height / 2 - 10, 60 + pulse * 120);
}

// fired by tinyStudio for every serial line received
function serialEvent(line) {
  if (line && line.indexOf('pulse') >= 0) pulse = 1;
}
