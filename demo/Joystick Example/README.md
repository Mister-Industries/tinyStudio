# qwiic_joystick

Stream the SparkFun Qwiic Joystick's X/Y position (and button) over serial, then watch
it move on a live grid in the **Visual** tab.

Built with **tinyStudio** for the **tinyCore** ESP32-S3 board by MR.INDUSTRIES.

## What it does

- [x] Talks to the Qwiic Joystick over I²C (default address `0x20`)
- [x] Reads horizontal + vertical as 10-bit values (`0..1023`, center `~512`)
- [x] Streams `x,y,button` over serial at `115200` baud
- [x] `visual.js` plots the position on an X/Y grid to match

## Hardware

The SparkFun Qwiic Joystick ([COM-15168](https://www.sparkfun.com/products/15168)) is an
I²C analog thumbstick. Plug it into the tinyCore **Qwiic** port with a Qwiic cable — no
soldering, no breadboard. (Qwiic carries `3V3 · GND · SDA · SCL`.)

Install the **SparkFun Qwiic Joystick Arduino Library** from the Library Manager.

## Signal flow

```mermaid
flowchart LR
  JOY[Qwiic Joystick] -->|I²C SDA/SCL| MCU[tinyCore]
  MCU -->|Serial.println x,y,button| MON[Serial Monitor]
  MON --> VIS[visual.js grid]
```

## Serial format

One line per sample, ~20 Hz:

```
512,498,0
```

`x , y , button` — `button` is `1` while pressed.

## Build

1. **Verify** to compile.
2. **Upload** to your connected tinyCore.
3. Open the **Visual** tab to watch the joystick move on the grid.
