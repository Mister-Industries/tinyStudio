/*
 * Appending to a File
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/save-data-to-sdcard/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/save-data-to-sdcard-appending-to
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include "FS.h"
#include "SD.h"
#include "SPI.h"

int bootCount = 0;

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }

  // Initialize SD card
  if (!SD.begin()) {
    Serial.println("Card Mount Failed!");
    return;
  }
  Serial.println("SD Card mounted!");

  // Open file in APPEND mode
  File logFile = SD.open("/bootlog.txt", FILE_APPEND);

  if (logFile) {
    // Get a simple "timestamp" (milliseconds since boot)
    unsigned long timestamp = millis();

    logFile.print("Device booted at ");
    logFile.print(timestamp);
    logFile.println(" ms");

    logFile.close();

    Serial.println("Boot logged successfully!");
  } else {
    Serial.println("Error opening file");
  }

  // Now let's read back all the boot entries
  Serial.println("\nAll boot entries:");
  Serial.println("------------------");

  File readFile = SD.open("/bootlog.txt");
  if (readFile) {
    while (readFile.available()) {
      Serial.write(readFile.read());
    }
    readFile.close();
  }
}

void loop() {
  // Nothing here
}
