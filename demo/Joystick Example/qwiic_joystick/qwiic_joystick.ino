// qwiic_joystick — stream the SparkFun Qwiic Joystick X/Y over serial
// generated & refined with Studio AI
//
// SparkFun Qwiic Joystick (COM-15168) is an I2C analog thumbstick. Plug it into
// the tinyCore Qwiic port with a Qwiic cable — no soldering, no breadboard.
// Install "SparkFun Qwiic Joystick Arduino Library" from the Library Manager.

#include <Wire.h>
#include "SparkFun_Qwiic_Joystick_Arduino_Library.h"

JOYSTICK joystick;
const uint8_t JOY_ADDR = 0x20;   // default Qwiic Joystick I2C address

void setup() {
  Serial.begin(115200);
  Wire.begin();                  // tinyCore Qwiic bus = I2C (SDA/SCL)

  if (joystick.begin(Wire, JOY_ADDR) == false) {
    Serial.println("Joystick not found on I2C — check the Qwiic cable. Halting.");
    while (1) delay(10);
  }
  Serial.println("# Qwiic Joystick ready — streaming x,y,button");
}

void loop() {
  int x = joystick.getHorizontal();             // 0..1023, center ~512
  int y = joystick.getVertical();               // 0..1023, center ~512
  int b = (joystick.getButton() == 0) ? 1 : 0;  // 1 = pressed

  // CSV line the Visual tab parses:  x,y,button
  Serial.print(x);
  Serial.print(',');
  Serial.print(y);
  Serial.print(',');
  Serial.println(b);

  delay(50);   // ~20 Hz
}
