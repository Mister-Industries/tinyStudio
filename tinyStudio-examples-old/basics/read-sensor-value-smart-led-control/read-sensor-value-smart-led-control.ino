/*
 * Smart LED control
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/read-sensor-value/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/read-sensor-value-smart-led-control
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Light-Controlled Auto LED

const int lightPin = 2;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);

  Serial.println("Automatic light controller ready");
  Serial.println("LED will turn on when it gets dark");
}

void loop() {
  int lightValue = analogRead(lightPin);

  // Convert to percentage (0-100)
  int lightLevel = map(lightValue, 0, 4095, 0, 100);

  // Auto-control LED based on light level
  if (lightLevel < 40) {
    digitalWrite(LED_BUILTIN, HIGH);  // Turn on LED when dark
    Serial.print("🌙 Dark detected (");
    Serial.print(lightLevel);
    Serial.println("%) - LED ON");
  } else {
    digitalWrite(LED_BUILTIN, LOW);   // Turn off LED when bright
    Serial.print("☀️ Light detected (");
    Serial.print(lightLevel);
    Serial.println("%) - LED OFF");
  }

  delay(500);
}
