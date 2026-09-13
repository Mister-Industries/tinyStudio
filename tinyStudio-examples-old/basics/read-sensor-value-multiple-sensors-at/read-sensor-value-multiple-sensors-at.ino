/*
 * Multiple sensors at once
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/read-sensor-value/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/read-sensor-value-multiple-sensors-at
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Multiple Analog Sensors

const int potPin = 1;    // Potentiometer on GPIO 1
const int lightPin = 2;  // Light sensor on GPIO 2

void setup() {
  Serial.begin(115200);
  Serial.println("Multi-sensor reader ready");

  // Headers for Serial Plotter
  Serial.println("Potentiometer,Light_Sensor");
}

void loop() {
  int potValue = analogRead(potPin);
  int lightValue = analogRead(lightPin);

  // Scale both to 0-100 range for easy comparison
  int potPercent = map(potValue, 0, 4095, 0, 100);
  int lightPercent = map(lightValue, 0, 4095, 0, 100);

  // Print for Serial Plotter
  Serial.print(potPercent);
  Serial.print(",");
  Serial.println(lightPercent);

  delay(50);
}
