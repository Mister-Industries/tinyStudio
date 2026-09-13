# Interactive Physics: The IMU Digital Hourglass

---

Displaying static text is great, but your tinyCore has a built-in 6DOF IMU! Let's combine the two and make an interactive digital hourglass.

When you tilt your tinyCore left, right, or upside down, the "sand" (pixels) on the screen will fall with gravity using the accelerometer data!

You'll need the `Adafruit_LSM6DSOX` library installed (which you should already have from the IMU tutorial).

Our simple code above lacks **Particle Collision**! We check if the sand hits the glass walls of the hourglass, but we aren't checking if a sand particle hits *another* sand particle.

Writing collision math for 60 particles checking against each other every frame is computationally heavy (an $O(N^2)$ problem). If you want a fun challenge, see if you can add basic collision detection so the sand piles up!

## Open it

- **tinyStudio (web)** — [open this project](https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/i2c-display-interactive-physics-the-imu)
- **tinyStudio (desktop)** — Examples tab → *Interactive Physics: The IMU Digital Hourglass*
- **Arduino IDE** — open `i2c-display-interactive-physics-the-imu/i2c-display-interactive-physics-the-imu.ino`

## Where this came from

From the tinyDocs page [Drawing Graphics with an OLED Display](https://tinydocs.cc/2_tiny-core/basics/i2c-display/).

Section: *4. Interactive Physics: The IMU Digital Hourglass*

> This sketch was one-shot by Gemini 3 Pro and checked by hand.

## Files

```
i2c-display-interactive-physics-the-imu/
  i2c-display-interactive-physics-the-imu.ino   ← the sketch
  README.md
```

---

_Generated from tinyDocs by `tools/sync-examples.py`. Edit the docs page above, not this file — regenerating overwrites it._
