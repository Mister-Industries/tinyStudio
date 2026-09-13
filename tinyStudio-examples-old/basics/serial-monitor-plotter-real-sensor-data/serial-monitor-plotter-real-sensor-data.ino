/*
 * Real sensor data visualization
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/serial-monitor-plotter/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/serial-monitor-plotter-real-sensor-data
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Real Sensor Data Plotting

void setup() {
  Serial.begin(115200);

  // Print column headers (Serial Plotter will ignore text after numbers start)
  Serial.println("Light_Sensor,Temperature_Simulation,Button_State");
  delay(1000);
}

void loop() {
  // Read actual sensor (if you have one connected)
  int lightValue = analogRead(1);  // GPIO 1
  int lightPercent = map(lightValue, 0, 4095, 0, 100);

  // Simulate temperature data
  static float temperature = 25.0;
  temperature += random(-10, 11) * 0.1;  // Random walk
  temperature = constrain(temperature, 15.0, 35.0);  // Keep realistic

  // Read button state (if connected)
  // For demo, we'll simulate button presses
  static int buttonCounter = 0;
  int buttonState = (buttonCounter % 100 < 10) ? 100 : 0;  // "Press" for 10% of time
  buttonCounter++;

  // Output for plotter
  Serial.print(lightPercent);
  Serial.print("\t");
  Serial.print(temperature);
  Serial.print("\t");
  Serial.println(buttonState);

  delay(100);
}
