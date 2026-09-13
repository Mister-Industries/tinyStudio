/*
 * Flash the tinyCore
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/1_get-started/imu/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/imu-serial-plotter
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <Adafruit_LSM6DSOX.h>


  Adafruit_LSM6DSOX lsm6dsox;
  unsigned long lastSampleTime = 0;
  const unsigned long SAMPLE_INTERVAL = 100; // Sample every 25ms

  void setup() {
    Serial.begin(115200);
    /* while (!Serial) {
      delay(10);
    }*/

    // Initialize IMU-related pins
    pinMode(6, OUTPUT);
    digitalWrite(6, HIGH);

    // Initialize I2C
    Wire.begin(3, 4);
    delay(100);

    Serial.println("Scanning for I2C devices...");
    for (byte address = 1; address < 127; address++) {
      Wire.beginTransmission(address);
      byte error = Wire.endTransmission();
      if (error == 0) {
        Serial.print("I2C device found at address 0x");
        if (address < 16) {
          Serial.print("0");
        }
        Serial.println(address, HEX);

        // If this is our LSM6DSOX address, try reading WHO_AM_I register
        if (address == 0x6A || address == 0x6B) {
          Wire.beginTransmission(address);
          Wire.write(0x0F);  // WHO_AM_I register address
          Wire.endTransmission(false);
          Wire.requestFrom(address, 1);
          if (Wire.available()) {
            byte whoAmI = Wire.read();
            Serial.print("WHO_AM_I register value: 0x");
            Serial.println(whoAmI, HEX);
            // Should be 0x6C for LSM6DSOX
          }
        }
      }
    }

    Serial.println("Attempting to initialize LSM6DSOX...");
    if (!lsm6dsox.begin_I2C()) {
      Serial.println("Failed to find LSM6DSOX chip");
      Serial.println("Check your wiring!");
      while (1) {
        delay(10);
      }
    }

    Serial.println("LSM6DSOX Found!");

    // Configure IMU settings
    lsm6dsox.setAccelRange(LSM6DS_ACCEL_RANGE_2_G);
    lsm6dsox.setGyroRange(LSM6DS_GYRO_RANGE_250_DPS);
    lsm6dsox.setAccelDataRate(LSM6DS_RATE_104_HZ);
    lsm6dsox.setGyroDataRate(LSM6DS_RATE_104_HZ);

    // Print labels for Serial Plotter
    Serial.println("AccelX:AccelY:AccelZ:GyroX:GyroY:GyroZ");
  }

  void sampleIMUData() {
    sensors_event_t accel;
    sensors_event_t gyro;
    sensors_event_t temp;
    lsm6dsox.getEvent(&accel, &gyro, &temp);

    // Format data for serial plotter (label:value:label:value format)
    Serial.print("AccelX:");
    Serial.print(accel.acceleration.x);
    Serial.print(",");
    Serial.print("AccelY:");
    Serial.print(accel.acceleration.y);
    Serial.print(",");
    Serial.print("AccelZ:");
    Serial.print(accel.acceleration.z);
    Serial.print(",");
    Serial.print("GyroX:");
    Serial.print(gyro.gyro.x);
    Serial.print(",");
    Serial.print("GyroY:");
    Serial.print(gyro.gyro.y);
    Serial.print(",");
    Serial.print("GyroZ:");
    Serial.println(gyro.gyro.z);
  }

  void loop() {
    unsigned long currentTime = millis();

    // Sample data at specified interval
    if (currentTime - lastSampleTime >= SAMPLE_INTERVAL) {
      sampleIMUData();
      lastSampleTime = currentTime;
    }
  }
