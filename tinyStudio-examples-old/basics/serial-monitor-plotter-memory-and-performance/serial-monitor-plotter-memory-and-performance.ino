/*
 * Memory and performance monitoring
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/serial-monitor-plotter/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/serial-monitor-plotter-memory-and-performance
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// System Performance Monitor

void setup() {
  Serial.begin(115200);
  Serial.println("=== System Performance Monitor ===");

  // Print system info
  Serial.print("Chip model: ");
  Serial.println(ESP.getChipModel());
  Serial.print("CPU frequency: ");
  Serial.print(ESP.getCpuFreqMHz());
  Serial.println(" MHz");
  Serial.print("Flash size: ");
  Serial.print(ESP.getFlashChipSize() / 1024 / 1024);
  Serial.println(" MB");
  Serial.println("---");
}

void loop() {
  static unsigned long lastCheck = 0;
  static int iterationCount = 0;

  unsigned long currentTime = millis();

  // Performance check every 5 seconds
  if (currentTime - lastCheck >= 5000) {
    Serial.println("=== Performance Report ===");

    // Memory usage
    Serial.print("Free heap: ");
    Serial.print(ESP.getFreeHeap());
    Serial.println(" bytes");

    // Loop performance
    Serial.print("Loop iterations in 5s: ");
    Serial.println(iterationCount);
    Serial.print("Average loop time: ");
    Serial.print(5000.0 / iterationCount, 2);
    Serial.println(" ms");

    // System uptime
    Serial.print("Uptime: ");
    Serial.print(currentTime / 1000);
    Serial.println(" seconds");

    Serial.println("---");

    lastCheck = currentTime;
    iterationCount = 0;
  }

  iterationCount++;

  // Simulate some work
  delay(10);
}
