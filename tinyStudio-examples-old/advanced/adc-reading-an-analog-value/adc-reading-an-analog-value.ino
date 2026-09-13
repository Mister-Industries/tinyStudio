/*
 * Reading an Analog Value
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/advanced/adc/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/advanced/adc-reading-an-analog-value
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

const int sensorPin = 1;  // GPIO 1, an ADC1 pin

void setup() {
  Serial.begin(115200);
}

void loop() {
  int raw = analogRead(sensorPin);            // uncalibrated: 0–4095
  int mV  = analogReadMilliVolts(sensorPin);  // calibrated: actual millivolts

  Serial.print("Raw: ");
  Serial.print(raw);
  Serial.print(" | Voltage: ");
  Serial.print(mV);
  Serial.println(" mV");
  delay(200);
}
