/*
 * Manual Brightness Control
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/blink-led/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/blink-brightness
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// PWM LED Control Example

const int ledBoot = 21;
const int ledSig = 33;

// PWM settings
const int pwmFreq = 5000;      // 5 KHz frequency
const int pwmResolution = 8;   // 8-bit resolution (0-255)

void setup() {
  // Configure PWM - channel selected automatically
  ledcAttach(ledBoot, pwmFreq, pwmResolution);
  ledcAttach(ledSig, pwmFreq, pwmResolution);
}

void loop() {
  // Very dim (10% brightness)
  ledcWrite(ledBoot, 25);
  ledcWrite(ledSig, 25);
  delay(1000);

  // Medium brightness (50%)
  ledcWrite(ledBoot, 128);
  ledcWrite(ledSig, 128);
  delay(1000);

  // Full brightness (100%)
  ledcWrite(ledBoot, 255);
  ledcWrite(ledSig, 255);
  delay(1000);

  // Turn off
  ledcWrite(ledBoot, 0);
  ledcWrite(ledSig, 0);
  delay(1000);
}
