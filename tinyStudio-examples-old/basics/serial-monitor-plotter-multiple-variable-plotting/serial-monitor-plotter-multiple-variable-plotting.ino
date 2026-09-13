/*
 * Multiple variable plotting
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/serial-monitor-plotter/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/serial-monitor-plotter-multiple-variable-plotting
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Multiple Signals for Serial Plotter

void setup() {
  Serial.begin(115200);
  delay(1000);
}

void loop() {
  static float time = 0;

  // Generate different waveforms
  float signal1 = 50 + 20 * sin(time);           // Sine wave
  float signal2 = 50 + 15 * sin(time * 2);       // Faster sine wave  
  float signal3 = 30 + 10 * sin(time * 0.5);     // Slower sine wave
  float signal4 = 20 + time * 2;                 // Rising ramp

  // For multiple plots, separate with tabs or spaces
  Serial.print(signal1);
  Serial.print("\t");    // Tab character
  Serial.print(signal2);
  Serial.print("\t");
  Serial.print(signal3);
  Serial.print("\t");
  Serial.println(signal4);  // Last value uses println

  time += 0.05;

  // Reset the ramp periodically
  if (time > 10) {
    time = 0;
  }

  delay(30);
}
