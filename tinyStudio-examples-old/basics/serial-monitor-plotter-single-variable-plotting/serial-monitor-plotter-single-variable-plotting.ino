/*
 * Single variable plotting
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/serial-monitor-plotter/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/serial-monitor-plotter-single-variable-plotting
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Basic Serial Plotter Demo

void setup() {
  Serial.begin(115200);
  Serial.println("Starting signal generation...");
  delay(1000);  // Give plotter time to start
}

void loop() {
  // Generate a simple sine wave
  static float angle = 0;

  float sineValue = 50 + 30 * sin(angle);  // Sine wave from 20 to 80

  // For Serial Plotter, just print the value
  Serial.println(sineValue);

  angle += 0.1;
  delay(50);  // Update rate affects how fast the wave moves
}
