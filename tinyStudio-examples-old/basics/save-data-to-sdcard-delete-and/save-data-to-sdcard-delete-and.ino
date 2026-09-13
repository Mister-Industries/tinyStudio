/*
 * Delete and List Files
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/save-data-to-sdcard/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/save-data-to-sdcard-delete-and
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

  if (!SD.begin()) {
    Serial.println("Card Mount Failed!");
    return;
  }
  Serial.println("SD Card mounted!\n");

  // List all files in root directory
  Serial.println("Files on SD card:");
  Serial.println("------------------");
  listDir("/");
  Serial.println("------------------\n");

  // Delete a specific file (uncomment to use)
  // deleteFile("/hello.txt");

  // Delete all .txt files (uncomment to use)
  // deleteAllTxtFiles("/");
}

void listDir(const char* dirname) {
  File root = SD.open(dirname);

  if (!root || !root.isDirectory()) {
    Serial.println("Failed to open directory");
    return;
  }

  File file = root.openNextFile();
  while (file) {
    if (file.isDirectory()) {
      Serial.print("  [DIR]  ");
      Serial.println(file.name());
    } else {
      Serial.print("  ");
      Serial.print(file.name());
      Serial.print("  (");
      Serial.print(file.size());
      Serial.println(" bytes)");
    }
    file = root.openNextFile();
  }
}

void deleteFile(const char* path) {
  Serial.print("Deleting file: ");
  Serial.println(path);

  if (SD.remove(path)) {
    Serial.println("File deleted successfully");
  } else {
    Serial.println("Delete failed - file may not exist");
  }
}

void deleteAllTxtFiles(const char* dirname) {
  File root = SD.open(dirname);

  if (!root || !root.isDirectory()) {
    return;
  }

  File file = root.openNextFile();
  while (file) {
    if (!file.isDirectory()) {
      String filename = String(file.name());
      if (filename.endsWith(".txt")) {
        String fullPath = String(dirname) + filename;
        file.close();  // Close before deleting
        SD.remove(fullPath.c_str());
        Serial.print("Deleted: ");
        Serial.println(fullPath);
      }
    }
    file = root.openNextFile();
  }
}

void loop() {
  // Nothing here
}
