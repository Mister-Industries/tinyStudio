// asteroids.js — Qwiic Joystick Asteroids
// Classic Asteroids driven by the SparkFun Qwiic Joystick.
// Reads the same CSV stream as the visualizer:  x,y,button   (x,y in 0..1023)
// Tilt LEFT / RIGHT to rotate, push UP to thrust, press the button to fire.
//
//   serialRead()  -> latest raw line, e.g. "512,498,0"
//   serialLines() -> recent raw lines (unused here, kept for parity)
//   serialEvent() -> fires per new line (kept for parity)
//
// Built for tinyStudio's harness. If the serial functions aren't present
// (e.g. a plain browser / the p5 web editor), it falls back to the keyboard
// (arrows to steer/thrust, space to fire) so you can test before wiring up.

const RANGE = 1023;          // 10-bit ADC full scale
const CENTER = RANGE / 2;    // joystick resting value
const DEADZONE = 90;         // ignore small wobble around center
const START_LIVES = 3;

// ---- palette (matches the visualizer) ----
const C_BG     = [10, 15, 45];
const C_SHIP   = [255, 255, 255];
const C_ROCK   = [150, 162, 196];
const C_BULLET = [255, 215, 0];   // gold
const C_TEXT   = [150, 162, 196];

// ---- tuning ----
const TURN_SPEED   = 0.07;    // radians per frame at full tilt
const THRUST_ACCEL = 0.12;
const FRICTION     = 0.99;
const MAX_SPEED    = 7;
const BULLET_SPEED = 7;
const BULLET_LIFE  = 60;      // frames
const FIRE_COOLDOWN = 10;     // frames between shots

let ship, bullets, rocks;
let score = 0, lives = START_LIVES;
let state = 'play';           // 'play' | 'over'
let joyX = CENTER, joyY = CENTER, lastBtn = 0;
let fireTimer = 0, invuln = 0;

function setup() {
  createCanvas(640, 440);
  textFont('monospace');
  resetGame();
}

function resetGame() {
  score = 0;
  lives = START_LIVES;
  state = 'play';
  bullets = [];
  spawnShip();
  rocks = [];
  for (let i = 0; i < 4; i++) rocks.push(makeRock());
}

function spawnShip() {
  ship = { x: width / 2, y: height / 2, vx: 0, vy: 0, angle: -PI / 2 };
  invuln = 90;
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

function makeRock(size, x, y) {
  size = size || 3;                  // 3 = large, 2 = medium, 1 = small
  // spawn at a random edge if no position given
  if (x === undefined) {
    if (random() < 0.5) { x = random() < 0.5 ? 0 : width; y = random(height); }
    else                { x = random(width); y = random() < 0.5 ? 0 : height; }
  }
  let r = size * 16;
  let speed = map(size, 3, 1, 0.7, 2.2);
  let a = random(TWO_PI);
  // give each rock a lumpy outline
  let verts = [];
  let n = floor(random(8, 12));
  for (let i = 0; i < n; i++) {
    verts.push(random(0.75, 1.15));
  }
  return {
    x, y, size, r,
    vx: cos(a) * speed,
    vy: sin(a) * speed,
    rot: random(-0.03, 0.03),
    spin: 0,
    verts
  };
}

function draw() {
  background(C_BG);
  handleInput();
  if (state === 'play') {
    updateShip();
    updateBullets();
    updateRocks();
    checkCollisions();
    if (rocks.length === 0) nextWave();
  }
  drawRocks();
  drawBullets();
  drawShip();
  drawHud();
}

function handleInput() {
  let p = readJoystick();
  let btn = 0;

  if (p) {
    joyX = p.x;
    joyY = p.y;
    btn = p.b;
  } else if (typeof serialRead !== 'function') {
    // no harness: keyboard fallback
    joyX = CENTER + (keyIsDown(RIGHT_ARROW) ? 400 : 0) - (keyIsDown(LEFT_ARROW) ? 400 : 0);
    joyY = CENTER + (keyIsDown(UP_ARROW) ? 400 : 0);
    btn = keyIsDown(32) ? 1 : 0;   // space
  }

  // rising-edge button: fire, or restart when game over
  if (btn === 1 && lastBtn === 0) onButton();
  lastBtn = btn;
}

function onButton() {
  if (state === 'over') {
    resetGame();
  } else if (fireTimer <= 0) {
    fire();
  }
}

function fire() {
  bullets.push({
    x: ship.x + cos(ship.angle) * 14,
    y: ship.y + sin(ship.angle) * 14,
    vx: cos(ship.angle) * BULLET_SPEED + ship.vx,
    vy: sin(ship.angle) * BULLET_SPEED + ship.vy,
    life: BULLET_LIFE
  });
  fireTimer = FIRE_COOLDOWN;
}

function updateShip() {
  if (fireTimer > 0) fireTimer--;
  if (invuln > 0) invuln--;

  // X axis -> rotate (deadzone keeps it steady at rest)
  let dx = joyX - CENTER;
  if (abs(dx) > DEADZONE) ship.angle += (dx / CENTER) * TURN_SPEED;

  // Y axis: push UP to thrust (joystick reads larger when pushed up)
  let dy = joyY - CENTER;
  if (dy > DEADZONE) {
    let t = (dy / CENTER) * THRUST_ACCEL;
    ship.vx += cos(ship.angle) * t;
    ship.vy += sin(ship.angle) * t;
  }

  // clamp speed + friction
  let sp = mag(ship.vx, ship.vy);
  if (sp > MAX_SPEED) { ship.vx *= MAX_SPEED / sp; ship.vy *= MAX_SPEED / sp; }
  ship.vx *= FRICTION;
  ship.vy *= FRICTION;

  ship.x = wrap(ship.x + ship.vx, width);
  ship.y = wrap(ship.y + ship.vy, height);
}

function updateBullets() {
  for (let b of bullets) {
    b.x = wrap(b.x + b.vx, width);
    b.y = wrap(b.y + b.vy, height);
    b.life--;
  }
  bullets = bullets.filter(b => b.life > 0);
}

function updateRocks() {
  for (let r of rocks) {
    r.x = wrap(r.x + r.vx, width);
    r.y = wrap(r.y + r.vy, height);
    r.spin += r.rot;
  }
}

function checkCollisions() {
  // bullets vs rocks
  for (let i = rocks.length - 1; i >= 0; i--) {
    let rock = rocks[i];
    for (let j = bullets.length - 1; j >= 0; j--) {
      let b = bullets[j];
      if (dist(b.x, b.y, rock.x, rock.y) < rock.r) {
        bullets.splice(j, 1);
        rocks.splice(i, 1);
        score += (4 - rock.size) * 10;   // small rocks worth more
        splitRock(rock);
        break;
      }
    }
  }

  // ship vs rocks (ignored while invulnerable)
  if (invuln <= 0) {
    for (let rock of rocks) {
      if (dist(ship.x, ship.y, rock.x, rock.y) < rock.r + 8) {
        loseLife();
        break;
      }
    }
  }
}

function splitRock(rock) {
  if (rock.size <= 1) return;
  for (let k = 0; k < 2; k++) {
    rocks.push(makeRock(rock.size - 1, rock.x, rock.y));
  }
}

function loseLife() {
  lives--;
  if (lives <= 0) {
    state = 'over';
  } else {
    spawnShip();
  }
}

function nextWave() {
  let count = 4 + floor(score / 200);
  for (let i = 0; i < count; i++) rocks.push(makeRock());
}

function wrap(v, max) {
  if (v < 0) return v + max;
  if (v > max) return v - max;
  return v;
}

// ---------- drawing ----------

function drawShip() {
  if (state !== 'play') return;
  if (invuln > 0 && frameCount % 10 < 5) return;   // blink while invulnerable

  push();
  translate(ship.x, ship.y);
  rotate(ship.angle);
  stroke(C_SHIP);
  strokeWeight(2);
  noFill();
  // triangle pointing along +x (angle 0)
  beginShape();
  vertex(14, 0);
  vertex(-10, -9);
  vertex(-5, 0);
  vertex(-10, 9);
  endShape(CLOSE);

  // thrust flame when pushing up
  if (joyY - CENTER > DEADZONE && frameCount % 6 < 3) {
    stroke(C_BULLET);
    line(-5, 0, -16, 0);
  }
  pop();
}

function drawBullets() {
  noStroke();
  fill(C_BULLET);
  for (let b of bullets) circle(b.x, b.y, 4);
}

function drawRocks() {
  stroke(C_ROCK);
  strokeWeight(2);
  noFill();
  for (let r of rocks) {
    push();
    translate(r.x, r.y);
    rotate(r.spin);
    beginShape();
    let n = r.verts.length;
    for (let i = 0; i < n; i++) {
      let a = (i / n) * TWO_PI;
      let rad = r.r * r.verts[i];
      vertex(cos(a) * rad, sin(a) * rad);
    }
    endShape(CLOSE);
    pop();
  }
}

function drawHud() {
  noStroke();
  textAlign(LEFT, TOP);
  textSize(20);
  fill(C_SHIP);
  text(score, 14, 12);

  // lives as little ships
  for (let i = 0; i < lives; i++) {
    push();
    translate(width - 20 - i * 22, 22);
    rotate(-PI / 2);
    stroke(C_SHIP);
    strokeWeight(2);
    noFill();
    beginShape();
    vertex(9, 0);
    vertex(-6, -6);
    vertex(-6, 6);
    endShape(CLOSE);
    pop();
  }

  if (state === 'over') {
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(28);
    fill(C_SHIP);
    text('GAME OVER', width / 2, height / 2 - 16);
    textSize(14);
    fill(C_BULLET);
    text('PRESS BUTTON TO RESTART', width / 2, height / 2 + 16);
  }
}

// fires per new serial line (kept for parity with the harness)
function serialEvent(line) {}
