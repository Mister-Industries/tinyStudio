/*
 * Hello World (Text on Screen!)
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/i2c-display/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/i2c-display-hello-world
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128 // OLED display width, in pixels
#define SCREEN_HEIGHT 64 // OLED display height, in pixels
#define OLED_RESET    -1 // Reset pin # (or -1 if sharing Arduino reset pin)

// The I2C address is usually 0x3C, but rarely can be 0x3D
#define SCREEN_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void setup() {
Serial.begin(115200);

// Initialize I2C on the tinyCore pins
Wire.begin(3, 4);

// Try to start the OLED
if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
Serial.println(F("SSD1306 allocation failed"));
for(;;); // Don't proceed, loop forever
}

// Clear the buffer
display.clearDisplay();

// Set up text properties
display.setTextSize(2);      // Normal 1:1 pixel scale is 1, 2 is bigger!
display.setTextColor(SSD1306_WHITE); // Draw 'light' text
display.setCursor(10, 20);   // Start drawing at (x=10, y=20)

display.println(F("tinyCore"));
display.println(F(" is cool!"));

// Show the display buffer on the hardware
display.display();
}

void loop() {
// We just want a static image, so loop is empty!
}
