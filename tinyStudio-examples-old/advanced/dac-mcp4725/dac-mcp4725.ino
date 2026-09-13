/*
 * MCP4725 (I2C, 12-bit)
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/advanced/dac/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/advanced/dac-mcp4725
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <Wire.h>
#include <Adafruit_MCP4725.h>

Adafruit_MCP4725 dac;

void setup() {
  pinMode(6, OUTPUT);
  digitalWrite(6, HIGH);    // power on I2C bus
  Wire.begin(3, 4);         // tinyCore I2C pins
  dac.begin(0x62);           // default address on Adafruit boards
}

void loop() {
  dac.setVoltage(2048, false);  // ~1.65V (half of 3.3V)
  delay(1000);
  dac.setVoltage(4095, false);  // ~3.3V (full scale)
  delay(1000);
  dac.setVoltage(0, false);     // 0V
  delay(1000);
}
