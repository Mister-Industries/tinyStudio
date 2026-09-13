/*
 * Interactive buzzer
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/buzz-buzzer/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/buzz-buzzer-interactive-buzzer
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Interactive Buzzer Control

const int buzzerPin = 2;
const int pwmChannel = 0;
const int resolution = 8;

void setup() {
  Serial.begin(115200);
  ledcSetup(pwmChannel, 2000, resolution);
  ledcAttachPin(buzzerPin, pwmChannel);

  Serial.println("=== Interactive Buzzer Control ===");
  Serial.println("Type letters to make sounds:");
  Serial.println("a-g = Musical notes");
  Serial.println("s = Siren");
  Serial.println("b = Beep");
  Serial.println("r = R2D2 sound");
  Serial.println("x = Stop sound");
}

void playNote(int frequency, int duration) {
  ledcWriteTone(pwmChannel, frequency);
  delay(duration);
  ledcWriteTone(pwmChannel, 0);
}

void playSiren() {
  for (int freq = 400; freq < 2000; freq += 50) {
    ledcWriteTone(pwmChannel, freq);
    delay(20);
  }
  for (int freq = 2000; freq > 400; freq -= 50) {
    ledcWriteTone(pwmChannel, freq);
    delay(20);
  }
  ledcWriteTone(pwmChannel, 0);
}

void playR2D2() {
  for (int i = 0; i < 5; i++) {
    ledcWriteTone(pwmChannel, 1000 + (i * 200));
    delay(100);
    ledcWriteTone(pwmChannel, 800 - (i * 100));
    delay(100);
  }
  ledcWriteTone(pwmChannel, 0);
}

void loop() {
  if (Serial.available()) {
    char command = Serial.read();

    switch (command) {
      case 'a': playNote(262, 500); break;  // C
      case 'b': playNote(294, 500); break;  // D
      case 'c': playNote(330, 500); break;  // E
      case 'd': playNote(349, 500); break;  // F
      case 'e': playNote(392, 500); break;  // G
      case 'f': playNote(440, 500); break;  // A
      case 'g': playNote(494, 500); break;  // B

      case 's': 
        Serial.println("🚨 Siren!");
        playSiren(); 
        break;

      case 'r':
        Serial.println("🤖 R2D2!");
        playR2D2();
        break;

      case 'b':
        Serial.println("📢 Beep!");
        playNote(1000, 200);
        break;

      case 'x':
        Serial.println("🔇 Stopping sound");
        ledcWriteTone(pwmChannel, 0);
        break;

      default:
        Serial.println("Unknown command!");
        break;
    }
  }
}
