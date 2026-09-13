/*
 * RGB Mood Light Controller
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/bluetooth/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/bluetooth-rgb-mood-light-controller
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// RGB LED pins
#define RED_PIN 25
#define GREEN_PIN 26
#define BLUE_PIN 27

// BLE characteristic for RGB values
BLECharacteristic* pRGBChar;

void setup() {
  // Initialize RGB pins
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);

  // Setup BLE (similar to basic example)
  // ...

  // Create RGB characteristic
  pRGBChar = pService->createCharacteristic(
    RGB_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
}

void loop() {
  // Handle RGB updates in BLE callback
}
