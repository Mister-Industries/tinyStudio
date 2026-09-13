/*
 * Basic button reading
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/button-press/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/basic-button-reading
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Simple Button Reading

const int buttonPin = 4;

void setup() {
  Serial.begin(115200);

  // Configure the pin as input with internal pull-up
  pinMode(buttonPin, INPUT_PULLUP);

  Serial.println("Button reader ready");
  Serial.println("Press the button and watch what happens");
}

void loop() {
  // Read the button state
  int buttonState = digitalRead(buttonPin);

  // Print the state (remember: pull-up logic is inverted)
  if (buttonState == LOW) {
    Serial.println("Button is PRESSED");
  } else {
    Serial.println("Button is NOT pressed");
  }

  delay(100);  // Don't spam the serial monitor
}
