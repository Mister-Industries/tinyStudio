# Using It in Code

The tinyCore reads the LSM6DSOX via I2C using the **Adafruit LSM6DS** Arduino library. Install it through the Arduino Library Manager (search "Adafruit LSM6DS").

When the board is sitting flat on a table, the Z-axis acceleration should read approximately **9.8 m/s²** (that's gravity). If all values read zero, the IMU probably didn't initialize — make sure you powered on the I2C bus with `GPIO 6` and called `Wire.begin(3, 4)` before `lsm6dsox.begin_I2C()`.

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/imu-using-it-in-code)
- **tinyStudio (desktop)** — Examples tab → *Using It in Code*
- **Arduino IDE** — open `imu-using-it-in-code/imu-using-it-in-code.ino`

## Where this came from

From the tinyDocs page [What is an IMU?](https://tinydocs.cc/5_reference/basics/imu/).

Section: *The LSM6DSOX on Your tinyCore › Using It in Code*

## Files

```
imu-using-it-in-code/
  imu-using-it-in-code.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
