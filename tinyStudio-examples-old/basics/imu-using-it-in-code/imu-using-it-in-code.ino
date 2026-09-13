/*
 * Using It in Code
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/basics/imu/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/imu-using-it-in-code
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <Adafruit_LSM6DSOX.h>
#include <Wire.h>

Adafruit_LSM6DSOX lsm6dsox;

void setup() {
  Serial.begin(115200);

  // Power on and init I2C
  pinMode(6, OUTPUT);
  digitalWrite(6, HIGH);
  delay(100);
  Wire.begin(3, 4);

  if (!lsm6dsox.begin_I2C()) {
    Serial.println("Failed to find LSM6DSOX!");
    while (1) delay(10);
  }
  Serial.println("LSM6DSOX found!");
}

void loop() {
  sensors_event_t accel, gyro, temp;
  lsm6dsox.getEvent(&accel, &gyro, &temp);

  Serial.print("Accel X: "); Serial.print(accel.acceleration.x);
  Serial.print(" Y: "); Serial.print(accel.acceleration.y);
  Serial.print(" Z: "); Serial.println(accel.acceleration.z);

  delay(100);
}
