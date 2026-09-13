# Detecting button events

Constantly checking if a button is pressed gets annoying fast. What we really want is to detect the moment when the button changes state - when it goes from not-pressed to pressed, or vice versa.

This is much cleaner. Now you only get a message when something actually happens, not a constant stream of status updates.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/detecting-button-events)
- **tinyStudio (desktop)** — Examples tab → *Detecting button events*
- **Arduino IDE** — open `detecting-button-events/detecting-button-events.ino`

## Where this came from

From the tinyDocs page [How to Read a Button Press (Digital Input)](https://tinydocs.cc/2_tiny-core/basics/button-press/).

Section: *Step 3: Detecting button events*

## Files

```
detecting-button-events/
  detecting-button-events.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
