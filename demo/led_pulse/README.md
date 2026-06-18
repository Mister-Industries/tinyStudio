# led_pulse

Blink an LED and report its state over serial — the tinyStudio demo project.

Built with **tinyStudio** for the **tinyCore** ESP32-S3 board by MR.INDUSTRIES
(also runs on an Arduino Uno).

## What it does

- Blinks the onboard LED once per second
- Prints `Hello World` once at startup
- Prints `On` / `Off` in step with the LED at `9600` baud

## Try it

1. Open this folder in tinyStudio (Files → Open Folder).
2. Pick your board and port in the toolbar, then **Verify** and **Upload**.
3. Open the **Serial Monitor** tab (next to Output) at 9600 baud — you'll see
   `Hello World`, then `On` / `Off` matching the LED.
4. Switch the **Code / Circuit / Visual** segment:
   - **Circuit** opens `diagram.json` as an editable wiring diagram.
   - **Visual** runs `visual.js` — a live p5 sketch fed by the serial output.

## Pin map

| Signal | Pin | Direction |
|--------|-----|-----------|
| LED    | SIG / 13 | output |
