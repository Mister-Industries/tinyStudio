// led_blink — blink the onboard LED and report its state over serial.
// The tinyStudio demo: prints "Hello World" once, then "On"/"Off" in step with
// the LED so the Serial Monitor (and the Visual view) match the board.

const uint8_t LED = 13;  // Uno onboard LED (also fine on tinyCore)

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Hello World");
}

void loop() {
  digitalWrite(LED, HIGH);
  Serial.println("ON");
  delay(1000);

  digitalWrite(LED, LOW);
  Serial.println("OFF");
  delay(1000);
}