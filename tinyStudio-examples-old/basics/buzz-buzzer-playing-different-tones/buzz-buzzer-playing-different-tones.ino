/*
 * Playing different tones
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/buzz-buzzer/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/buzz-buzzer-playing-different-tones
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Musical Scale with Buzzer

const int buzzerPin = 2;
const int pwmChannel = 0;
const int resolution = 8;

// Musical note frequencies (in Hz)
const int NOTE_C4 = 262;
const int NOTE_D4 = 294;
const int NOTE_E4 = 330;
const int NOTE_F4 = 349;
const int NOTE_G4 = 392;
const int NOTE_A4 = 440;
const int NOTE_B4 = 494;
const int NOTE_C5 = 523;

void setup() {
  Serial.begin(115200);
  ledcSetup(pwmChannel, 2000, resolution);
  ledcAttachPin(buzzerPin, pwmChannel);

  Serial.println("Playing musical scale...");
}

void playNote(int frequency, int duration) {
  if (frequency > 0) {
    ledcWriteTone(pwmChannel, frequency);
  } else {
    ledcWriteTone(pwmChannel, 0);  // Rest (silence)
  }
  delay(duration);
  ledcWriteTone(pwmChannel, 0);  // Stop sound
  delay(50);  // Small pause between notes
}

void loop() {
  // Play a C major scale
  playNote(NOTE_C4, 500);
  playNote(NOTE_D4, 500);
  playNote(NOTE_E4, 500);
  playNote(NOTE_F4, 500);
  playNote(NOTE_G4, 500);
  playNote(NOTE_A4, 500);
  playNote(NOTE_B4, 500);
  playNote(NOTE_C5, 500);

  delay(1000);  // Pause before repeating
}
