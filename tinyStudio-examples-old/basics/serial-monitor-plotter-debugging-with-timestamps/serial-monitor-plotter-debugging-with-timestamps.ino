/*
 * Debugging with timestamps
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/serial-monitor-plotter/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/serial-monitor-plotter-debugging-with-timestamps
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Advanced Debugging with Timestamps

unsigned long startTime;

void setup() {
  Serial.begin(115200);
  startTime = millis();

  Serial.println("=== Advanced Debug Log ===");
  debugPrint("System initialization started");
}

void debugPrint(String message) {
  unsigned long currentTime = millis() - startTime;

  // Format: [HH:MM:SS.mmm] MESSAGE
  unsigned long seconds = currentTime / 1000;
  unsigned long minutes = seconds / 60;
  unsigned long hours = minutes / 60;

  Serial.print("[");
  if (hours < 10) Serial.print("0");
  Serial.print(hours % 24);
  Serial.print(":");
  if ((minutes % 60) < 10) Serial.print("0");
  Serial.print(minutes % 60);
  Serial.print(":");
  if ((seconds % 60) < 10) Serial.print("0");
  Serial.print(seconds % 60);
  Serial.print(".");

  unsigned long milliseconds = currentTime % 1000;
  if (milliseconds < 100) Serial.print("0");
  if (milliseconds < 10) Serial.print("0");
  Serial.print(milliseconds);

  Serial.print("] ");
  Serial.println(message);
}

void loop() {
  static int loopCount = 0;

  if (loopCount % 500 == 0) {  // Every 500 loops
    debugPrint("Periodic status check - system running normally");
  }

  if (loopCount == 1000) {
    debugPrint("Simulated sensor reading: 42.7°C");
  }

  if (loopCount == 2000) {
    debugPrint("Warning: Temperature threshold exceeded");
  }

  loopCount++;
  delay(10);
}
