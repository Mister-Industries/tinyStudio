/*
 * Example: Play a Tone on a Buzzer
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/advanced/pwm/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/advanced/pwm-example-play-a-tone-on
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

const int buzzerPin = 2;
const int channel = 0;

void setup() {
  ledcSetup(channel, 1000, 8);
  ledcAttachPin(buzzerPin, channel);
}

void loop() {
  ledcWriteTone(channel, 440);   // play A4 (440 Hz)
  delay(500);
  ledcWriteTone(channel, 523);   // play C5 (523 Hz)
  delay(500);
  ledcWriteTone(channel, 0);     // silence
  delay(500);
}
