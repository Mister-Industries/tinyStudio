/*
 * Code for External LED
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/blink-led/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/blink-external-led
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// External LED Control on tinyCore ESP32-S3

const int externalLed = 13;    // External LED on IO13

void setup() {
  pinMode(externalLed, OUTPUT);
}

void loop() {
  // Light chase effect
  digitalWrite(externalLed, LOW);
  delay(300);

  digitalWrite(externalLed, HIGH);
  delay(300);
}
