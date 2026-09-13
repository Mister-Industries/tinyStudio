/*
 * SOS Signal
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/blink-led/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/blink-sos
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

//Morse Code "SOS"

const int ledBoot = 21;
const int ledSig = 33;

void setup() {
  // Initialize both built-in LEDs as outputs
  pinMode(ledBoot, OUTPUT);
  pinMode(ledSig, OUTPUT);

  // Start with both LEDs off
  digitalWrite(ledBoot, LOW);
  digitalWrite(ledSig, LOW);
}

void loop() {
  // S (short-short-short)
  for(int i = 0; i < 3; i++) {
    digitalWrite(ledBoot, HIGH);
    delay(200);
    digitalWrite(ledBoot, LOW);
    delay(200);
  }
  delay(300);

  // O (long-long-long)
  for(int i = 0; i < 3; i++) {
    digitalWrite(ledBoot, HIGH);
    delay(600);
    digitalWrite(ledBoot, LOW);
    delay(200);
  }
  delay(300);

  // S (short-short-short)
  for(int i = 0; i < 3; i++) {
    digitalWrite(ledBoot, HIGH);
    delay(200);
    digitalWrite(ledBoot, LOW);
    delay(200);
  }
  delay(2000);
}
