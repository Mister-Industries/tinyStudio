# Blink Example

Blink an LED and report its state over serial — the tinyStudio demo project.

Built with **tinyStudio** for the **tinyCore** ESP32-S3 board by MR.INDUSTRIES
(also runs on an Arduino Uno).

## Project layout

```
Blink Example/
  led_blink/
    led_blink.ino   ← the Arduino sketch (its own folder, per Arduino convention)
  diagram.json      ← the circuit (Circuit view)
  visual.js         ← the p5 sketch (Visual view)
  README.md         ← this file
  index.html        ← created when you Export the Visual for the web
```

## Try it

1. Open this folder in tinyStudio (Files → Open Folder → "Blink Example").
2. Pick your board and port, then **Verify** and **Upload**.
3. Open the **Serial Monitor** (next to Output) at 9600 baud — `Hello World`,
   then `On` / `Off` in step with the LED.
4. Use the **Code / Circuit / Visual** segment:
   - **Circuit** — the wiring in `diagram.json`.
   - **Visual** — `visual.js` runs live: a glowing LED that mirrors the board,
     with a scrolling on/off timeline. Hit **Export** to publish it as a web page.

## Pin map

| Signal | Pin | Direction |
|--------|-----|-----------|
| LED    | SIG / 13 | output |
