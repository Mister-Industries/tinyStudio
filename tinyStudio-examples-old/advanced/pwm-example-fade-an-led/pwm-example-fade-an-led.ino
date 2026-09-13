/*
 * Example: Fade an LED
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/advanced/pwm/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/advanced/pwm-example-fade-an-led
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

const int ledPin = 21;     // LED_BOOT on tinyCore
const int channel = 0;
const int freq = 5000;     // 5 kHz — no visible flicker
const int resolution = 8;  // 8-bit: 0–255

void setup() {
  ledcSetup(channel, freq, resolution);
  ledcAttachPin(ledPin, channel);
}

void loop() {
  // Fade up
  for (int duty = 0; duty <= 255; duty++) {
    ledcWrite(channel, duty);
    delay(10);
  }
  // Fade down
  for (int duty = 255; duty >= 0; duty--) {
    ledcWrite(channel, duty);
    delay(10);
  }
}
