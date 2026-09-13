/*
 * Writing to a File
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/save-data-to-sdcard/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/save-data-to-sdcard-writing-to
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

  // Create and open a file for writing
  File myFile = SD.open("/hello.txt", FILE_WRITE);

  if (myFile) {
    Serial.println("Writing to hello.txt...");

    myFile.println("Hello from tinyCore!");
    myFile.println("This is my first SD card file.");
    myFile.println("Pretty cool, right?");

    myFile.close();  // Always close the file when done!
    Serial.println("Done! File saved.");
  } else {
    Serial.println("Error opening file for writing");
  }
}

void loop() {
  // Nothing here
}
