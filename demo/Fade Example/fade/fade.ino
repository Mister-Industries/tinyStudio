// fade — smoothly ramp an LED up and down with PWM, reporting brightness.
// The tinyStudio "analog" companion to Blink: instead of on/off, the LED
// breathes, and each loop prints the current 0–255 brightness on its own line
// so the Serial Monitor (and the Visual view) can chart the curve.

const uint8_t LED = 13;  // PWM-capable pin on tinyCore (also fine on an Uno)

int brightness = 0;      // current duty cycle, 0–255
int step = 5;            // how much to change each frame

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  analogWrite(LED, brightness);
  Serial.println(brightness);   // one number per line → easy to parse in visual.js

  brightness += step;
  if (brightness <= 0 || brightness >= 255) {
    step = -step;               // reverse direction at each end
  }
  delay(100);
}
