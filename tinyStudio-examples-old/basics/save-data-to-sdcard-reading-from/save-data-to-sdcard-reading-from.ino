/*
 * Reading from a File
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/save-data-to-sdcard/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/save-data-to-sdcard-reading-from
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include "FS.h"
#include "SD.h"
#include "SPI.h"

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

  // Open the file for reading
  File myFile = SD.open("/hello.txt");

  if (myFile) {
    Serial.println("Reading from hello.txt:");
    Serial.println("------------------------");

    // Read and print each character until end of file
    while (myFile.available()) {
      Serial.write(myFile.read());
    }

    Serial.println("------------------------");
    myFile.close();
  } else {
    Serial.println("Error opening file for reading");
    Serial.println("Did you run the Write example first?");
  }
}

void loop() {
  // Nothing here
}
