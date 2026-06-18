// blink_sig — pulse the onboard SIG LED when the D9 button is pressed.
// Works on tinyCore (ESP32-S3) and Arduino Uno; the demo project for tinyStudio.
//#include "tinyCore.h"

const uint8_t LED = 13;  // Uno onboard LED / tinyCore SIG
const uint8_t BTN = 8;   // button to GND (uses internal pull-up)

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(BTN, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(BTN) == LOW) {
    digitalWrite(LED, HIGH);
    Serial.println("pulse");
  } else {
    digitalWrite(LED, LOW);
  }
  delay(500);
}
