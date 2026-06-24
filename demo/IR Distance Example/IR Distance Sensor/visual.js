// visual.js — Serial Plotter
// Graphs the latest number printed over Serial (serialValue()) as a scrolling
// line, auto-scaling to the data. Try Serial.println(analogRead(A0)) on the
// board. Switch to Code to edit this sketch; Visual to run it.

let data = [];
const MAX = 240; // points kept on screen

function setup() {
  createCanvas(480, 280);
  textFont('monospace');
}

function draw() {
  background(7, 11, 34);

  // pull the most recent serial value each frame
  data.push(serialValue());
  if (data.length > MAX) data.shift();

  // auto-scale to the data range (with a little headroom)
  let lo = Math.min(...data, 0);
  let hi = Math.max(...data, 1);
  if (hi === lo) hi = lo + 1;

  // grid
  stroke(26, 31, 77);
  strokeWeight(1);
  for (let i = 0; i <= 4; i++) {
    let y = map(i, 0, 4, 20, height - 24);
    line(40, y, width - 12, y);
  }

  // plotted line
  noFill();
  stroke(0, 240, 255);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < data.length; i++) {
    let x = map(i, 0, MAX - 1, 40, width - 12);
    let y = map(data[i], lo, hi, height - 24, 20);
    vertex(x, y);
  }
  endShape();

  // readouts
  noStroke();
  fill(235, 238, 255);
  textSize(12);
  text('value: ' + serialValue().toFixed(2), 44, 16);
  fill(120, 130, 170);
  text(hi.toFixed(0), 8, 24);
  text(lo.toFixed(0), 8, height - 24);
}
