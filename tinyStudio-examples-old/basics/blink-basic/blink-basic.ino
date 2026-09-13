/*
 * Basic Blink Program
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/blink-led/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/blink-basic
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

//Basic Blink Example

    const int ledBoot = 21;    // LED_BOOT pin
    const int ledSig = 33;     // LED_SIG pin

    void setup() {
      // Initialize both built-in LEDs as outputs
      pinMode(ledBoot, OUTPUT);
      pinMode(ledSig, OUTPUT);

      // Start with both LEDs off
      digitalWrite(ledBoot, LOW);
      digitalWrite(ledSig, LOW);
    }

    void loop() {
      // Turn LEDs on
      digitalWrite(ledBoot, HIGH);   // Turn on
      digitalWrite(ledSig, HIGH);    // Turn off
      delay(500);

      // Turn LEDs off
      digitalWrite(ledBoot, LOW);    // Turn on
      digitalWrite(ledSig, LOW);     // Turn off
      delay(500);
  }
