/*
 * CSV Data Logging
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/save-data-to-sdcard/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/save-data-to-sdcard-csv-data
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include "FS.h"
#include "SD.h"
#include "SPI.h"

File dataFile;
const char* FILENAME = "/sensor_data.csv";
unsigned long lastLogTime = 0;
const unsigned long LOG_INTERVAL = 1000;  // Log every 1 second
int readingCount = 0;

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

  // Check if file exists to decide whether to write header
  bool fileExists = SD.exists(FILENAME);

  // Open file for appending
  dataFile = SD.open(FILENAME, FILE_APPEND);

  if (!dataFile) {
    Serial.println("Error opening data file!");
    return;
  }

  // Write CSV header if this is a new file
  if (!fileExists) {
    dataFile.println("timestamp_ms,reading_number,temperature,humidity,pressure");
    Serial.println("Created new CSV file with header");
  } else {
    Serial.println("Appending to existing CSV file");
  }

  Serial.println("\nLogging started! Data format:");
  Serial.println("timestamp_ms,reading_number,temperature,humidity,pressure");
  Serial.println("Press reset to stop logging.\n");
}

void loop() {
  unsigned long currentTime = millis();

  // Log data at the specified interval
  if (currentTime - lastLogTime >= LOG_INTERVAL) {
    lastLogTime = currentTime;
    readingCount++;

    // Generate some fake sensor data (replace with real sensors!)
    float temperature = 20.0 + random(-50, 50) / 10.0;  // 15.0 to 25.0
    float humidity = 50.0 + random(-100, 100) / 10.0;   // 40.0 to 60.0
    float pressure = 1013.0 + random(-50, 50) / 10.0;   // 1008.0 to 1018.0

    // Create CSV line
    String dataLine = String(currentTime) + "," +
                      String(readingCount) + "," +
                      String(temperature, 2) + "," +
                      String(humidity, 2) + "," +
                      String(pressure, 2);

    // Write to SD card
    dataFile.println(dataLine);
    dataFile.flush();  // Make sure data is written immediately

    // Also print to Serial for monitoring
    Serial.println(dataLine);

    // Stop after 60 readings (1 minute) to save your SD card
    if (readingCount >= 60) {
      dataFile.close();
      Serial.println("\n60 readings logged. File closed.");
      Serial.println("Remove SD card and check your data!");
      while (1) { delay(1000); }  // Stop the loop
    }
  }
}
