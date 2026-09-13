/*
 * Reading a potentiometer
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/read-sensor-value/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/read-sensor-value-reading-a-potentiometer
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Basic Potentiometer Reading

const int potPin = 1;  // ADC pin for potentiometer

void setup() {
  Serial.begin(115200);
  Serial.println("Potentiometer reader ready");
  Serial.println("Turn the knob and watch the values change");
}

void loop() {
  // Read the raw ADC value (0-4095)
  int rawValue = analogRead(potPin);

  // Convert to voltage (0-3.3V)
  float voltage = (rawValue / 4095.0) * 3.3;

  // Convert to percentage (0-100%)
  int percentage = (rawValue * 100) / 4095;

  // Print all three ways of looking at the data
  Serial.print("Raw: ");
  Serial.print(rawValue);
  Serial.print(" | Voltage: ");
  Serial.print(voltage, 2);
  Serial.print("V | Percentage: ");
  Serial.print(percentage);
  Serial.println("%");

  delay(100);
}
