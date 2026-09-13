# The I2C Scanner: Your Best Debugging Tool

An I2C scanner is a short program that checks every possible address (1–127) and reports which ones respond. It's the **first thing you should run** when a sensor isn't working. If the scanner doesn't find your device, you know the problem is physical (wiring, power, bad connection) and not in your application code.

Running this on a tinyCore with nothing plugged into the QWIIC ports should still return **`0x6A`** — that's the onboard IMU. If you don't see it, check that you've set GPIO 6 HIGH and called `Wire.begin(3, 4)`.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/the-i2c-scanner-your-best-debugging)
- **tinyStudio (desktop)** — Examples tab → *The I2C Scanner: Your Best Debugging Tool*
- **Arduino IDE** — open `the-i2c-scanner-your-best-debugging/the-i2c-scanner-your-best-debugging.ino`

## Where this came from

From the tinyDocs page [What is I2C?](https://tinydocs.cc/5_reference/basics/i2c/).

Section: *The I2C Scanner: Your Best Debugging Tool*

## Files

```
the-i2c-scanner-your-best-debugging/
  the-i2c-scanner-your-best-debugging.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
