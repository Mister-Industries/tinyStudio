/*
 * Understanding NOT logic
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/button-press/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/button-press-understanding-not-logic
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// NOT Gate Logic with Built-in LED

const int buttonPin = 4;

void setup() {
  Serial.begin(115200);
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);  // Use the built-in LED

  Serial.println("NOT gate demo ready");
  Serial.println("LED will be ON when button is NOT pressed");
}

void loop() {
  int buttonState = digitalRead(buttonPin);

  // This is the NOT gate logic:
  // If button is NOT pressed (HIGH), LED is ON
  // If button IS pressed (LOW), LED is OFF
  digitalWrite(LED_BUILTIN, buttonState);

  delay(50);  // Small delay for stability
}
