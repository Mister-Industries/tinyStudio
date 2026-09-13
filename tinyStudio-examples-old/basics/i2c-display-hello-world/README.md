# Hello World (Text on Screen!)

---

Let's test our display by printing some simple text.

Notice how we called `display.println()` but nothing actually happens until we call `display.display()`?

This is called "buffering". The tinyCore does all the math in its own memory first, and then blasts the entire finished frame to the OLED all at once. This prevents the screen from flickering while it draws.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/i2c-display-hello-world)
- **tinyStudio (desktop)** — Examples tab → *Hello World (Text on Screen!)*
- **Arduino IDE** — open `i2c-display-hello-world/i2c-display-hello-world.ino`

## Where this came from

From the tinyDocs page [Drawing Graphics with an OLED Display](https://tinydocs.cc/2_tiny-core/basics/i2c-display/).

Section: *3. Hello World (Text on Screen!)*

> This sketch was one-shot by Gemini 3 Pro and checked by hand.

## Files

```
i2c-display-hello-world/
  i2c-display-hello-world.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
