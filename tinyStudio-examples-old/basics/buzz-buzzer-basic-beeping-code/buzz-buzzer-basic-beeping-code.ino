/*
 * Basic beeping code
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/buzz-buzzer/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/buzz-buzzer-basic-beeping-code
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Simple Buzzer Beep for tinyCore ESP32-S3

const int buzzerPin = 2;        // GPIO pin connected to buzzer
const int pwmChannel = 0;       // PWM channel (ESP32 has 16 channels)
const int resolution = 8;       // 8-bit resolution (0-255 values)

void setup() {
  Serial.begin(115200);

  // Configure the PWM channel
  ledcSetup(pwmChannel, 1000, resolution);  // 1000 Hz frequency, 8-bit resolution

  // Attach the PWM channel to our buzzer pin
  ledcAttachPin(buzzerPin, pwmChannel);

  Serial.println("Buzzer ready! Making some noise...");
}

void loop() {
  // Play a 1000 Hz tone
  ledcWriteTone(pwmChannel, 1000);
  delay(500);  // Beep for half a second

  // Stop the sound
  ledcWriteTone(pwmChannel, 0);
  delay(500);  // Silence for half a second
}
