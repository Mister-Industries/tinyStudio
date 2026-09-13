# Basic Connection Code

The flow: set station mode → call `WiFi.begin()` with your credentials → wait for `WL_CONNECTED` → get your IP with `WiFi.localIP()`. That IP is what you type into a browser to reach a web server running on the tinyCore.

**Never hardcode your WiFi password in code you push to GitHub.** Create a separate `secrets.h` file with your credentials and add it to `.gitignore`. For a more robust solution, the `WiFiManager` library lets you configure credentials via a phone browser — the tinyCore creates a temporary setup network, you enter your WiFi info, and it's saved to flash.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/advanced/wifi-basic-connection-code)
- **tinyStudio (desktop)** — Examples tab → *Basic Connection Code*
- **Arduino IDE** — open `wifi-basic-connection-code/wifi-basic-connection-code.ino`

## Where this came from

From the tinyDocs page [What is WiFi?](https://tinydocs.cc/5_reference/advanced/wifi/).

Section: *Basic Connection Code*

## Files

```
wifi-basic-connection-code/
  wifi-basic-connection-code.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
