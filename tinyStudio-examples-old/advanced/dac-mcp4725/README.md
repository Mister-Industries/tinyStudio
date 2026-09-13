# MCP4725 (I2C, 12-bit)

The beginner favorite. One output channel, 4,096 voltage steps, dead-simple I2C interface. Available as a QWIIC/STEMMA breakout — just plug in a cable, no breadboard needed.

The `setVoltage()` function takes a value from 0 to 4095. Output voltage = `(value / 4096) × 3.3V`. The second parameter (`false`) means "don't save to EEPROM" — keep it `false` for normal use.

If the default I2C address doesn't work, try `0x60` — different MCP4725 breakouts use different defaults. Run an [I2C scanner](/5_reference/basics/i2c/) if you're stuck.

Install the library: **Sketch → Include Library → Manage Libraries → search "Adafruit MCP4725" → Install.**

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/advanced/dac-mcp4725)
- **tinyStudio (desktop)** — Examples tab → *MCP4725 (I2C, 12-bit)*
- **Arduino IDE** — open `dac-mcp4725/dac-mcp4725.ino`

## Where this came from

From the tinyDocs page [What is a DAC?](https://tinydocs.cc/5_reference/advanced/dac/).

Section: *Option 3: External DAC Chip for Precise Voltage › MCP4725 (I2C, 12-bit)*

## Files

```
dac-mcp4725/
  dac-mcp4725.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
