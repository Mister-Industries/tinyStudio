/*
 * Multiple buttons, multiple behaviors
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/button-press/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/button-press-multiple-buttons-multiple-behaviors
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Multiple Button Control

const int button1Pin = 4;
const int button2Pin = 5;

int lastButton1State = HIGH;
int lastButton2State = HIGH;
int ledState = LOW;

void setup() {
  Serial.begin(115200);

  // Setup buttons
  pinMode(button1Pin, INPUT_PULLUP);
  pinMode(button2Pin, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);

  Serial.println("Multi-button control ready");
  Serial.println("Button 1 (GPIO 4): Toggle LED on/off");
  Serial.println("Button 2 (GPIO 5): Flash LED while pressed");
}

void loop() {
  // Check button 1 (toggle behavior)
  int currentButton1State = digitalRead(button1Pin);
  if (currentButton1State != lastButton1State && currentButton1State == LOW) {
    ledState = !ledState;
    digitalWrite(LED_BUILTIN, ledState);
    Serial.println(ledState ? "💡 LED toggled ON" : "💡 LED toggled OFF");
  }
  lastButton1State = currentButton1State;

  // Check button 2 (flash while pressed)
  int currentButton2State = digitalRead(button2Pin);
  if (currentButton2State == LOW) {
    // Flash the LED rapidly while button 2 is held
    digitalWrite(LED_BUILTIN, HIGH);
    delay(50);
    digitalWrite(LED_BUILTIN, LOW);
    delay(50);
  }

  // If button 2 is not pressed, restore the toggle state from button 1
  if (currentButton2State == HIGH) {
    digitalWrite(LED_BUILTIN, ledState);
  }

  lastButton2State = currentButton2State;
  delay(10);
}
