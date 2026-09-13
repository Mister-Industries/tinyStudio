/*
 * Basic Code: Write and Read a File
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/basics/sd-card/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/sd-card-basic-code-write-and
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include "FS.h"
#include "SD.h"
#include "SPI.h"

#define CS_PIN 10  // Change to tinyCore's actual CS pin

void setup() {
  Serial.begin(115200);
  delay(2000);

  if (!SD.begin(CS_PIN)) {
    Serial.println("Card Mount Failed");
    return;
  }
  Serial.println("SD card ready.");

  // Write a file
  File file = SD.open("/hello.txt", FILE_WRITE);
  if (file) {
    file.println("Hello from tinyCore!");
    file.close();  // ALWAYS close files after writing
  }

  // Read it back
  file = SD.open("/hello.txt");
  if (file) {
    while (file.available()) {
      Serial.write(file.read());
    }
    file.close();
  }
}

void loop() {}
