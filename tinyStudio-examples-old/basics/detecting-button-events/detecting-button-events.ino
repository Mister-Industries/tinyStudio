/*
 * Detecting button events
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/button-press/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/detecting-button-events
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Button Press Detection

const int buttonPin = 4;

int lastButtonState = HIGH;    // Previous button state
int currentButtonState;        // Current button state

void setup() {
  Serial.begin(115200);
  pinMode(buttonPin, INPUT_PULLUP);

  Serial.println("Button event detector ready");
  Serial.println("Try pressing and releasing the button");
}

void loop() {
  // Read the current state
  currentButtonState = digitalRead(buttonPin);

  // Check if the state has changed
  if (currentButtonState != lastButtonState) {

    // Determine what kind of change it was
    if (currentButtonState == LOW) {
      Serial.println("🔽 Button PRESSED");
    } else {
      Serial.println("🔼 Button RELEASED");
    }

    // Update the last state
    lastButtonState = currentButtonState;
  }

  delay(10);  // Small delay for stability
}
