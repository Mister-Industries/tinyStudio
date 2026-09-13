# Light sensor (photoresistor)

Let's try something more practical - a light sensor that responds to brightness. An LDR (Light Dependent Resistor) changes its resistance based on how much light hits it.

Since the LDR is just a variable resistor, we need to pair it with a fixed resistor to create a voltage divider. Wire it like this:

1. **One side of LDR** → **3.3V** on tinyCore
2. **Other side of LDR** → **GPIO 2** on tinyCore AND one side of 10kΩ resistor
3. **Other side of 10kΩ resistor** → **GND** on tinyCore

![LDR Wiring](./read-sensor-value/ldr-wiring.png)

Cover the sensor with your hand and watch the values change. Point a flashlight at it and see them jump up.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/read-sensor-value-light-sensor)
- **tinyStudio (desktop)** — Examples tab → *Light sensor (photoresistor)*
- **Arduino IDE** — open `read-sensor-value-light-sensor/read-sensor-value-light-sensor.ino`

## Where this came from

From the tinyDocs page [How to Read Sensor Values (Analog Input)](https://tinydocs.cc/2_tiny-core/basics/read-sensor-value/).

Section: *Step 4: Light sensor (photoresistor)*

## Files

```
read-sensor-value-light-sensor/
  read-sensor-value-light-sensor.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
