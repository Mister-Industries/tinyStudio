/*
 * Interactive Physics: The IMU Digital Hourglass
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/i2c-display/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/i2c-display-interactive-physics-the-imu
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_LSM6DSOX.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_LSM6DSOX lsm6dsox;

// Sand Particle Settings
#define NUM_PARTICLES 60
float px[NUM_PARTICLES];
float py[NUM_PARTICLES];

void setup() {
Serial.begin(115200);

// Initialize I2C on pins 3 and 4
Wire.begin(3, 4);

// Start OLED
display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS);

// Power up the IMU
pinMode(6, OUTPUT);
digitalWrite(6, HIGH);
delay(100);

lsm6dsox.begin_I2C();

// Spawn all sand particles in the top half of the hourglass
for(int i=0; i<NUM_PARTICLES; i++) {
px[i] = random(50, 78);
py[i] = random(5, 25);
}
}

void drawHourglass() {
// Top and bottom lids
display.drawLine(40, 0, 88, 0, SSD1306_WHITE);
display.drawLine(40, 63, 88, 63, SSD1306_WHITE);

// Left wall
display.drawLine(40, 0, 62, 31, SSD1306_WHITE);
display.drawLine(62, 31, 40, 63, SSD1306_WHITE);

// Right wall
display.drawLine(88, 0, 66, 31, SSD1306_WHITE);
display.drawLine(66, 31, 88, 63, SSD1306_WHITE);
}

void loop() {
// 1. Get current gravity vectors from IMU
sensors_event_t accel, gyro, temp;
lsm6dsox.getEvent(&accel, &gyro, &temp);

// Invert the axes depending on how your screen and board are physically oriented!
float gravityX = accel.acceleration.y * -0.5;
float gravityY = accel.acceleration.x * -0.5;

display.clearDisplay();
drawHourglass();

// 2. Update and draw each particle of sand
for(int i=0; i<NUM_PARTICLES; i++) {
float nextX = px[i] + gravityX;
float nextY = py[i] + gravityY;

 // Extremely simplified boundary constraints (bouncing off the glass)
 if (nextY < 31) { // Top half constraints
   if (nextX < 40 + (nextY * 0.7)) nextX = px[i];
   if (nextX > 88 - (nextY * 0.7)) nextX = px[i];
 } else {          // Bottom half constraints
   if (nextX < 62 - ((nextY-31) * 0.7)) nextX = px[i];
   if (nextX > 66 + ((nextY-31) * 0.7)) nextX = px[i];
 }

 // Floor and ceiling
 if (nextY < 2) nextY = 2;
 if (nextY > 61) nextY = 61;

 // Save the new calculated position
 px[i] = nextX;
 py[i] = nextY;

 // Draw the grain of sand
 display.drawPixel((int)px[i], (int)py[i], SSD1306_WHITE);

}

// 3. Blast the frame to the screen!
display.display();
delay(15); // Frame rate delay
}
