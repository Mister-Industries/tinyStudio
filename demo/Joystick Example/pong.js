// pong.js — Qwiic Joystick Pong
// Single-player Pong driven by the SparkFun Qwiic Joystick.
// Reads the same CSV stream as the visualizer:  x,y,button   (x,y in 0..1023)
// Push the stick UP / DOWN to move the left paddle. Press the button to serve.
//
//   serialRead()  -> latest raw line, e.g. "512,498,0"
//   serialLines() -> recent raw lines (unused here, kept for parity)
//   serialEvent() -> fires per new line (kept for parity)
//
// Built for tinyStudio's harness. If the serial functions aren't present
// (e.g. a plain browser / the p5 web editor), it falls back to the mouse so
// you can test the game logic before wiring up hardware.

const RANGE = 1023;          // 10-bit ADC full scale
const WIN_SCORE = 7;

// ---- palette (matches the visualizer) ----
const C_BG     = [0, 0, 0];
const C_NET    = [26, 34, 70];
const C_PLAYER = [255, 255, 255];   // cyan
const C_AI     = [255, 255, 255];  // pink
const C_BALL   = [255, 215, 0];   // gold
const C_TEXT   = [150, 162, 196];

// ---- geometry ----
const PADDLE_W = 12;
const PADDLE_H = 84;
const PADDLE_INSET = 26;     // distance of the paddle face from the wall
const BALL_R = 9;
const AI_MAX_SPEED = 5.2;    // lower = easier to beat

let player, ai, ball;
let scoreP = 0, scoreA = 0;
let state = 'serve';         // 'serve' | 'play' | 'over'
let winner = '';
let joyY = 512, lastBtn = 0;

function setup() {
  createCanvas(640, 440);
  textFont('monospace');
  player = { x: PADDLE_INSET, y: height / 2 };
  ai     = { x: width - PADDLE_INSET, y: height / 2 };
  resetBall(1);
}

// parse "x,y,button" -> {x,y,b} or null  (same regex as the visualizer)
function parseLine(s) {
  let m = String(s).match(/(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*(\d+))?/);
  if (!m) return null;
  return { x: int(m[1]), y: int(m[2]), b: m[3] ? int(m[3]) : 0 };
}

// read the joystick if the harness is present, else null
function readJoystick() {
  if (typeof serialRead !== 'function') return null;
  return parseLine(serialRead());
}

function resetBall(dir) {
  // dir: +1 serves right (toward CPU), -1 serves left (toward you)
  ball = {
    x: width / 2,
    y: height / 2,
    vx: 4.2 * dir,
    vy: random(-2.2, 2.2),
    speed: 4.6
  };
}

function draw() {
  background(C_BG);
  handleInput();
  if (state === 'play') updateBall();
  drawNet();
  drawPaddles();
  drawBall();
  drawHud();
}

function handleInput() {
  let p = readJoystick();
  let btn = 0;

  if (p) {
    joyY = p.y;          // fresh joystick sample
    btn = p.b;
  } else if (typeof serialRead !== 'function') {
    // no harness: mouse Y drives the paddle, click serves
    joyY = map(mouseY, height, 0, 0, RANGE, true);
    btn = mouseIsPressed ? 1 : 0;
  }
  // (harness present but no parseable line yet -> keep last joyY, btn stays 0)

  // stick UP -> paddle UP, matching the visualizer's inverted Y
  player.y = map(joyY, 0, RANGE, height - PADDLE_H / 2, PADDLE_H / 2, true);

  // rising-edge button: serve or restart
  if (btn === 1 && lastBtn === 0) onButton();
  lastBtn = btn;
}

function onButton() {
  if (state === 'serve') {
    state = 'play';
  } else if (state === 'over') {
    scoreP = 0;
    scoreA = 0;
    winner = '';
    state = 'serve';
    resetBall(random() < 0.5 ? 1 : -1);
  }
}

function updateBall() {
  ball.x += ball.vx;
  ball.y += ball.vy;

  // top / bottom walls
  if (ball.y - BALL_R < 0)      { ball.y = BALL_R; ball.vy *= -1; }
  if (ball.y + BALL_R > height) { ball.y = height - BALL_R; ball.vy *= -1; }

  bouncePaddle(player, +1);   // left paddle -> ball leaves rightward
  bouncePaddle(ai, -1);       // right paddle -> ball leaves leftward

  // CPU: chase only while the ball approaches, else drift back to center
  let targetY = ball.vx > 0 ? ball.y : height / 2;
  ai.y += constrain(targetY - ai.y, -AI_MAX_SPEED, AI_MAX_SPEED);
  ai.y = constrain(ai.y, PADDLE_H / 2, height - PADDLE_H / 2);

  // scoring
  if (ball.x + BALL_R < 0)     { scoreA++; afterPoint(-1); }  // CPU scored
  if (ball.x - BALL_R > width) { scoreP++; afterPoint(+1); }  // you scored
}

function bouncePaddle(pad, dir) {
  // dir: +1 = paddle on the left, -1 = paddle on the right
  let halfW = PADDLE_W / 2;
  let halfH = PADDLE_H / 2;

  // only register a hit when the ball is heading toward this paddle
  if (dir > 0 && ball.vx >= 0) return;
  if (dir < 0 && ball.vx <= 0) return;

  let withinX = abs(ball.x - pad.x) <= halfW + BALL_R;
  let withinY = ball.y >= pad.y - halfH - BALL_R &&
                ball.y <= pad.y + halfH + BALL_R;
  if (!(withinX && withinY)) return;

  // reflect with angle based on where it struck the paddle, speed up a touch
  ball.speed = min(ball.speed + 0.35, 11);
  let offset = constrain((ball.y - pad.y) / halfH, -1, 1); // -1 (top) .. 1 (bottom)
  let angle = offset * (PI / 3.2);                         // up to ~56°
  ball.vx = ball.speed * cos(angle) * dir;
  ball.vy = ball.speed * sin(angle);

  // nudge clear so it can't stick inside the paddle
  ball.x = pad.x + dir * (halfW + BALL_R + 0.5);
}

function afterPoint(scorer) {
  // scorer: +1 you scored, -1 CPU scored
  if (scoreP >= WIN_SCORE || scoreA >= WIN_SCORE) {
    state = 'over';
    winner = scoreP > scoreA ? 'PLAYER' : 'CPU';
    return;
  }
  state = 'serve';
  resetBall(scorer);   // serve toward whoever just conceded the point
}

function drawNet() {
  stroke(C_NET);
  strokeWeight(3);
  for (let y = 12; y < height; y += 26) line(width / 2, y, width / 2, y + 14);
}

function drawPaddles() {
  noStroke();
  rectMode(CENTER);
  // player (cyan) with glow
  fill(C_PLAYER[0], C_PLAYER[1], C_PLAYER[2], 60);
  rect(player.x, player.y, PADDLE_W + 8, PADDLE_H + 8, 6);
  fill(C_PLAYER);
  rect(player.x, player.y, PADDLE_W, PADDLE_H, 4);
  // CPU (pink) with glow
  fill(C_AI[0], C_AI[1], C_AI[2], 60);
  rect(ai.x, ai.y, PADDLE_W + 8, PADDLE_H + 8, 6);
  fill(C_AI);
  rect(ai.x, ai.y, PADDLE_W, PADDLE_H, 4);
  rectMode(CORNER);
}

function drawBall() {
  noStroke();
  fill(C_BALL[0], C_BALL[1], C_BALL[2], 60);
  circle(ball.x, ball.y, BALL_R * 2 + 12);
  fill(C_BALL);
  circle(ball.x, ball.y, BALL_R * 2);
}

function drawHud() {
  noStroke();
  textAlign(CENTER, TOP);
  textSize(34);
  fill(C_PLAYER);
  text(scoreP, width / 2 - 60, 12);
  fill(C_AI);
  text(scoreA, width / 2 + 60, 12);

  textSize(11);
  fill(C_TEXT);
  textAlign(LEFT, TOP);
  text('YOU', 14, 16);
  textAlign(RIGHT, TOP);
  text('CPU', width - 14, 16);

  if (state === 'serve') {
    banner('PRESS BUTTON TO SERVE');
  } else if (state === 'over') {
    banner((winner === 'PLAYER' ? 'YOU WIN!' : 'CPU WINS') + '   PRESS TO RESTART');
  }
}

function banner(msg) {
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(16);
  fill(C_BALL);
  text(msg, width / 2, height - 28);
}

// fires per new serial line (kept for parity with the harness)
function serialEvent(line) {}
