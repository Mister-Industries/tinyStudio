# Multiple sensors at once

The ESP32-S3 has multiple ADC pins, so you can read several sensors simultaneously:

Open the Serial Plotter and you'll see two lines - one tracking your potentiometer, the other tracking the light level. Try changing both at the same time and watch how the graphs respond.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/read-sensor-value-multiple-sensors-at)
- **tinyStudio (desktop)** — Examples tab → *Multiple sensors at once*
- **Arduino IDE** — open `read-sensor-value-multiple-sensors-at/read-sensor-value-multiple-sensors-at.ino`

## Where this came from

From the tinyDocs page [How to Read Sensor Values (Analog Input)](https://tinydocs.cc/2_tiny-core/basics/read-sensor-value/).

Section: *Step 5: Multiple sensors at once*

## Files

```
read-sensor-value-multiple-sensors-at/
  read-sensor-value-multiple-sensors-at.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
