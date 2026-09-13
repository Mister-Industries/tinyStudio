# Reading a potentiometer

Let's start with the simplest analog sensor - a potentiometer (variable resistor). Wire it up like this:

1. **Left pin of potentiometer** → **3.3V** on tinyCore
2. **Middle pin of potentiometer** → **GPIO 1** on tinyCore
3. **Right pin of potentiometer** → **GND** on tinyCore

![Potentiometer Wiring](./read-sensor-value/potentiometer-wiring.png)

Now try this code:

Upload this and open the Serial Monitor. Turn the potentiometer knob and watch the numbers change. You should see values from 0 to 4095 for raw readings, 0V to 3.3V for voltage, and 0% to 100% for percentage.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/read-sensor-value-reading-a-potentiometer)
- **tinyStudio (desktop)** — Examples tab → *Reading a potentiometer*
- **Arduino IDE** — open `read-sensor-value-reading-a-potentiometer/read-sensor-value-reading-a-potentiometer.ino`

## Where this came from

From the tinyDocs page [How to Read Sensor Values (Analog Input)](https://tinydocs.cc/2_tiny-core/basics/read-sensor-value/).

Section: *Step 2: Reading a potentiometer*

## Files

```
read-sensor-value-reading-a-potentiometer/
  read-sensor-value-reading-a-potentiometer.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
