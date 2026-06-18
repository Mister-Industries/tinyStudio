# led_pulse

Pulse an LED on button press — the tinyStudio demo project.

Built with **tinyStudio** for the **tinyCore** ESP32-S3 board by MR.INDUSTRIES.

## What it does

- Reads the D9 button (internal pull-up)
- Drives the `SIG` LED while the button is held
- Streams `pulse` over serial at `9600` baud

## Try it

1. Open this folder in tinyStudio (Files → Open Folder).
2. Pick your board and port in the toolbar, then **Verify** and **Upload**.
3. Switch the **Code / Circuit / Visual** segment:
   - **Circuit** opens `diagram.json` as an editable wiring diagram.
   - **Visual** runs `visual.js` — a live p5 sketch fed by the serial output.

## Pin map

| Signal | Pin | Direction |
|--------|-----|-----------|
| LED    | SIG | output    |
| Button | D9  | input ↧   |
