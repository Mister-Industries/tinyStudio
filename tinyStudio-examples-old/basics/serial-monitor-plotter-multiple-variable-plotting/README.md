# Multiple variable plotting

The real power comes from plotting multiple signals simultaneously:

This creates four different colored lines on the plotter. The plotter automatically scales the Y-axis to fit all the data and assigns different colors to each signal.

**Key formatting rules for Serial Plotter:**
- Separate multiple values with **tab (`\t`)** or **space (` `)** characters
- End the line with **`Serial.println()`** for the last value
- All values on one line get plotted at the same time point
- Don't include text labels in the data (save those for Serial Monitor)

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/serial-monitor-plotter-multiple-variable-plotting)
- **tinyStudio (desktop)** — Examples tab → *Multiple variable plotting*
- **Arduino IDE** — open `serial-monitor-plotter-multiple-variable-plotting/serial-monitor-plotter-multiple-variable-plotting.ino`

## Where this came from

From the tinyDocs page [How to use the Serial Monitor and Serial Plotter](https://tinydocs.cc/2_tiny-core/basics/serial-monitor-plotter/).

Section: *Serial Plotter for data visualization › Multiple variable plotting*

## Files

```
serial-monitor-plotter-multiple-variable-plotting/
  serial-monitor-plotter-multiple-variable-plotting.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
