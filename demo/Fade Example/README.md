# Fade Example

Smoothly fade an LED with PWM and chart the brightness curve — the "analog"
companion to the Blink demo.

Built with **tinyStudio** for the **tinyCore** ESP32-S3 board by MR.INDUSTRIES
(also runs on an Arduino Uno).

## Project layout

```
Fade Example/
  fade/
    fade.ino        ← the Arduino sketch (its own folder, per Arduino convention)
  diagram.json      ← the circuit (Circuit view)
  visual.js         ← the p5 sketch (Visual view)
  README.md         ← this file
```

## Try it

1. Open this folder in tinyStudio (Files → Open Folder → "Fade Example").
2. Pick your board and port, then **Verify** and **Upload**.
3. Open the **Serial Monitor** (next to Output) at 9600 baud — a stream of
   numbers from `0` to `255` and back as the LED breathes.
4. Use the **Code / Circuit / Visual** segment:
   - **Circuit** — the wiring in `diagram.json`: `SIG → resistor → LED → GND`.
   - **Visual** — `visual.js` runs live: a bulb that glows in proportion to the
     PWM value, with a scrolling brightness curve underneath.

## Pin map

| Signal | Pin      | Direction   |
| ------ | -------- | ----------- |
| LED    | SIG / 13 | output (PWM) |

## How it works

`analogWrite(LED, brightness)` sets the PWM duty cycle, and `brightness` ramps
0 → 255 → 0 in steps of 5. Each loop prints the current value with
`Serial.println(brightness)` — one number per line — which is exactly what
`visual.js` parses in `serialEvent()` to drive the bulb and the chart.
