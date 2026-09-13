# Basic button reading

Let's start with code that just tells you when the button is pressed:

Upload this and open the Serial Monitor. You'll see it constantly telling you whether the button is pressed or not.

Notice something important: when you press the button, it reads LOW, not HIGH. That's because of the pull-up resistor - it inverts the logic.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/basic-button-reading)
- **tinyStudio (desktop)** — Examples tab → *Basic button reading*
- **Arduino IDE** — open `basic-button-reading/basic-button-reading.ino`

## Where this came from

From the tinyDocs page [How to Read a Button Press (Digital Input)](https://tinydocs.cc/2_tiny-core/basics/button-press/).

Section: *Step 2: Basic button reading*

## Files

```
basic-button-reading/
  basic-button-reading.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
