/*
 * Toggle behavior vs direct control
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/button-press/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/button-press-toggle-behavior-vs-direct
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// LED Toggle with Built-in LED

const int buttonPin = 4;

int lastButtonState = HIGH;
int ledState = LOW;        // Keep track of LED state

void setup() {
  Serial.begin(115200);
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);

  // Start with LED off
  digitalWrite(LED_BUILTIN, ledState);

  Serial.println("LED toggle ready");
  Serial.println("Press button to toggle LED on/off");
}

void loop() {
  int currentButtonState = digitalRead(buttonPin);

  // If button state changed AND button is now pressed
  if (currentButtonState != lastButtonState && currentButtonState == LOW) {

    // Toggle the LED state
    ledState = !ledState;
    digitalWrite(LED_BUILTIN, ledState);

    // Give some feedback
    Serial.print("LED is now ");
    Serial.println(ledState ? "ON" : "OFF");
  }

  lastButtonState = currentButtonState;
  delay(10);
}
