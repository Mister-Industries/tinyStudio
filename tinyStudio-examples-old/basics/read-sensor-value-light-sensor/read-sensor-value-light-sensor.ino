/*
 * Light sensor (photoresistor)
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/read-sensor-value/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/read-sensor-value-light-sensor
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Light Sensor Reader

const int lightPin = 2;

void setup() {
  Serial.begin(115200);
  Serial.println("Light sensor ready");
  Serial.println("Try covering the sensor or shining light on it");
}

void loop() {
  int lightValue = analogRead(lightPin);

  // Convert to a light level percentage
  // Note: This might be inverted depending on your LDR
  int lightLevel = map(lightValue, 0, 4095, 0, 100);

  Serial.print("Light level: ");
  Serial.print(lightLevel);
  Serial.print("% (raw: ");
  Serial.print(lightValue);
  Serial.println(")");

  // Simple threshold detection
  if (lightLevel > 70) {
    Serial.println("  💡 It's bright in here!");
  } else if (lightLevel < 30) {
    Serial.println("  🌙 It's getting dark...");
  }

  delay(200);
}
