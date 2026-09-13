/*
 * PWM Control for All Three LEDs
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/blink-led/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/blink-pwm-wave
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// PWM control for built-in and external LEDs

const int ledBoot = 21;
const int ledSig = 33;
const int externalLed = 13;

void setup() {
  // Configure PWM for all LEDs
  ledcAttach(ledBoot, 5000, 8);
  ledcAttach(ledSig, 5000, 8);
  ledcAttach(externalLed, 5000, 8);
}

void loop() {
  // "Wave" effect
  for(int i = 0; i < 256; i++) {
    ledcWrite(ledBoot, (sin(i * 0.02) * 127 + 128));
    ledcWrite(ledSig, (sin(i * 0.02 + 2) * 127 + 128));
    ledcWrite(externalLed, (sin(i * 0.02 + 4) * 127 + 128));
    delay(20);
  }
}
