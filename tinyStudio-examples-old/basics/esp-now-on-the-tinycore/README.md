# On the tinyCore

ESP-NOW is built into the ESP32-S3 — no libraries to install, no extra hardware. The tinyCore's existing [Link two tinyCores](/2_tiny-core/basics/link-tiny-cores/) tutorial walks through the full setup with code, including finding your MAC addresses and establishing two-way communication.

The key code steps:

**Finding your MAC address:** Check the sticker on your tinyCore kit box — your MAC address should be printed there. If you can't find it, upload a sketch with `WiFi.macAddress()` and check the Serial Monitor.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/esp-now-on-the-tinycore)
- **tinyStudio (desktop)** — Examples tab → *On the tinyCore*
- **Arduino IDE** — open `esp-now-on-the-tinycore/esp-now-on-the-tinycore.ino`

## Where this came from

From the tinyDocs page [What is ESP-NOW?](https://tinydocs.cc/5_reference/basics/esp-now/).

Section: *On the tinyCore*

## Files

```
esp-now-on-the-tinycore/
  esp-now-on-the-tinycore.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
