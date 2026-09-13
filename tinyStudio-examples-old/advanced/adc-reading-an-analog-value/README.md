# Reading an Analog Value

**Use `analogReadMilliVolts()` instead of manual math.** The ESP32-S3 stores factory calibration data in its eFuse memory, and `analogReadMilliVolts()` applies it automatically. This is significantly more accurate than calculating `raw * 3300 / 4095` yourself, especially at the extremes of the voltage range.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/advanced/adc-reading-an-analog-value)
- **tinyStudio (desktop)** — Examples tab → *Reading an Analog Value*
- **Arduino IDE** — open `adc-reading-an-analog-value/adc-reading-an-analog-value.ino`

## Where this came from

From the tinyDocs page [What is an ADC?](https://tinydocs.cc/5_reference/advanced/adc/).

Section: *Reading an Analog Value*

## Files

```
adc-reading-an-analog-value/
  adc-reading-an-analog-value.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
