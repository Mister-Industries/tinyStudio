/*
 * Play a real song
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/buzz-buzzer/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/buzz-buzzer-play-a-real-song
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Twinkle Twinkle Little Star

const int buzzerPin = 2;
const int pwmChannel = 0;
const int resolution = 8;

// Note frequencies
const int NOTE_C4 = 262;
const int NOTE_D4 = 294;
const int NOTE_E4 = 330;
const int NOTE_F4 = 349;
const int NOTE_G4 = 392;
const int NOTE_A4 = 440;
const int NOTE_B4 = 494;
const int REST = 0;

// Twinkle Twinkle melody
int melody[] = {
  NOTE_C4, NOTE_C4, NOTE_G4, NOTE_G4, NOTE_A4, NOTE_A4, NOTE_G4, REST,
  NOTE_F4, NOTE_F4, NOTE_E4, NOTE_E4, NOTE_D4, NOTE_D4, NOTE_C4, REST,
  NOTE_G4, NOTE_G4, NOTE_F4, NOTE_F4, NOTE_E4, NOTE_E4, NOTE_D4, REST,
  NOTE_G4, NOTE_G4, NOTE_F4, NOTE_F4, NOTE_E4, NOTE_E4, NOTE_D4, REST,
  NOTE_C4, NOTE_C4, NOTE_G4, NOTE_G4, NOTE_A4, NOTE_A4, NOTE_G4, REST,
  NOTE_F4, NOTE_F4, NOTE_E4, NOTE_E4, NOTE_D4, NOTE_D4, NOTE_C4, REST
};

// Note durations (in milliseconds)
int noteDurations[] = {
  400, 400, 400, 400, 400, 400, 600, 200,
  400, 400, 400, 400, 400, 400, 600, 200,
  400, 400, 400, 400, 400, 400, 600, 200,
  400, 400, 400, 400, 400, 400, 600, 200,
  400, 400, 400, 400, 400, 400, 600, 200,
  400, 400, 400, 400, 400, 400, 800, 400
};

void setup() {
  Serial.begin(115200);
  ledcSetup(pwmChannel, 2000, resolution);
  ledcAttachPin(buzzerPin, pwmChannel);

  Serial.println("Playing Twinkle Twinkle Little Star!");
}

void playSong() {
  int songLength = sizeof(melody) / sizeof(melody[0]);

  for (int i = 0; i < songLength; i++) {
    if (melody[i] > 0) {
      ledcWriteTone(pwmChannel, melody[i]);
    } else {
      ledcWriteTone(pwmChannel, 0);  // Rest
    }

    delay(noteDurations[i]);
    ledcWriteTone(pwmChannel, 0);  // Stop sound
    delay(50);  // Small pause between notes
  }
}

void loop() {
  playSong();
  delay(2000);  // Wait 2 seconds before playing again
}
