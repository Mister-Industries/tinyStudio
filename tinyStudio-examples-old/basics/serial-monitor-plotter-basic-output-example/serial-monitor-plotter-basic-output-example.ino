/*
 * Basic output example
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/serial-monitor-plotter/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/serial-monitor-plotter-basic-output-example
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Basic Serial Monitor Output

void setup() {
  // Initialize serial communication at 115200 bps
  Serial.begin(115200);

  // Wait a moment for the serial connection to stabilize
  delay(1000);

  Serial.println("=== tinyCore System Starting ===");
  Serial.println("Firmware version: 1.0");
  Serial.print("Compiled on: ");
  Serial.print(__DATE__);
  Serial.print(" at ");
  Serial.println(__TIME__);
  Serial.println("System ready for commands");
}

void loop() {
  static int counter = 0;

  // Print different types of data
  Serial.print("Loop iteration: ");
  Serial.println(counter);

  // Print sensor-like data with labels
  float fakeTemperature = 20.5 + (counter % 10);
  Serial.print("Temperature: ");
  Serial.print(fakeTemperature, 1);  // 1 decimal place
  Serial.println("°C");

  // Print system status
  Serial.print("Free memory: ");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");

  Serial.println("---");

  counter++;
  delay(2000);  // Update every 2 seconds
}
