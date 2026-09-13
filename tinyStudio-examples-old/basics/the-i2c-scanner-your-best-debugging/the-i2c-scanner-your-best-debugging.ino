/*
 * The I2C Scanner: Your Best Debugging Tool
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/basics/i2c/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/the-i2c-scanner-your-best-debugging
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <Wire.h>

void setup() {
  pinMode(6, OUTPUT);
  digitalWrite(6, HIGH);      // power on the QWIIC bus
  Serial.begin(115200);
  Wire.begin(3, 4);           // SDA = GPIO 3, SCL = GPIO 4
}

void loop() {
  Serial.println("Scanning...");
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print("Device found at 0x");
      Serial.println(addr, HEX);
    }
  }
  delay(5000);
}
