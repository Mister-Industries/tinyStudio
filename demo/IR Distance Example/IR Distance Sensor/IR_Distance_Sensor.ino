/*
  IR Distance Sensor
  
  Created with tinyStudio
  Date: 6/24/2026
  
  Description:
  A basic sketch template. Customize this code for your project needs.
*/

// Pin definitions
const int LED_PIN = 13;  // Built-in LED pin

void setup() {
  // Initialize serial communication
  Serial.begin(9600);
  
  // Initialize digital pin LED_PIN as an output
  pinMode(LED_PIN, OUTPUT);
  
  Serial.println("IR Distance Sensor - Setup complete!");
}

void loop() {
  // Turn the LED on
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED ON");
  delay(1000);  // Wait for a second
  
  // Turn the LED off
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED OFF");
  delay(1000);  // Wait for a second
}
