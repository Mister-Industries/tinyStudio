/*
 * Visualizing with Serial Plotter
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/read-sensor-value/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/read-sensor-value-visualizing-with-serial
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Potentiometer for Serial Plotter

const int potPin = 1;

void setup() {
  Serial.begin(115200);

  // Print headers for the plotter
  Serial.println("Raw_Value,Voltage_x100,Percentage");
}

void loop() {
  int rawValue = analogRead(potPin);
  float voltage = (rawValue / 4095.0) * 3.3;
  int percentage = (rawValue * 100) / 4095;

  // Print values separated by commas for plotter
  Serial.print(rawValue);
  Serial.print(",");
  Serial.print(voltage * 100);  // Multiply by 100 so it shows nicely
  Serial.print(",");
  Serial.println(percentage);

  delay(50);
}
