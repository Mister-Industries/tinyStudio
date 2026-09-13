/*
 * Smooth Breathing Effect
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/blink-led/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/blink-breathing
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
  // Breathing effect - fade in
  for(int brightness = 0; brightness <= 255; brightness++) {
    ledcWrite(ledBoot, brightness);
    ledcWrite(ledSig, 255 - brightness);  // Opposite brightness
    delay(10);
  }

  // Breathing effect - fade out
  for(int brightness = 255; brightness >= 0; brightness--) {
    ledcWrite(ledBoot, brightness);
    ledcWrite(ledSig, 255 - brightness);  // Opposite brightness
    delay(10);
  }
}
