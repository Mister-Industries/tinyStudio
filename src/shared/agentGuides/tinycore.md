# tinyCore hardware

The attached image is the official tinyCore V2 pinout. Yellow labels are GPIO numbers, green are ADC channels, grey are Arduino pin names.

## The board

- ESP32-S3-MINI (dual core, no PSRAM), with WiFi and Bluetooth LE.
- USB-C with native USB serial, plus a LiPo JST-PH connector with an onboard charger.
- LSM6DSO-family 6-axis IMU (accelerometer + gyro) on I2C.
- Micro SD card slot on SPI.
- Two STEMMA QT / Qwiic I2C connectors.
- Two user LEDs: LED_SIG and LED_BOOT.
- 50 × 50 mm. Everything is 3.3 V logic.
- In tinyStudio the board is **tinyCore** (FQBN `tinyCore:esp32:tiny_core_esp32s3_nopsram`). It builds with Arduino-ESP32 core **3.1**.

## Pin table

"pin" is the name used in `circuit.json` pin refs (`tinycore:D13`). "in code" is what to write in the sketch.

{{PIN_TABLE}}

## Using pins in code

- **Header labels are not all constants.** `A0`–`A5`, `SDA`, `SCL`, `SCK`, `MOSI`, `MISO`, `RX`, `TX` and `LED_BUILTIN` are defined. The right header's `D8`–`D13` are not: write `8`…`13`, e.g. `const int ledPin = 13;`.
- **A0–A5 are not GPIO 0–5.** `A0` is GPIO 18 and `A5` is GPIO 7. Use the constant, or give the real GPIO number in a comment.
- The variant also defines `A6`–`A13` and touch pins `T3`–`T14`. They are aliases for GPIOs already listed (for example `A9` is GPIO 9); prefer the header names.
- Name pins after what's wired to them: `const int buttonPin = 9; // D9 → button → GND`.

## Capabilities and pitfalls

- **Digital I/O**: any GPIO in the table. `INPUT_PULLUP` and `INPUT_PULLDOWN` are available, so a button can go pin → button → GND with no resistor.
- **Current**: keep each GPIO under about 20 mA. LEDs need a series resistor (220–330 Ω).
- **Analog in**: `analogRead()` is 12-bit (0–4095) over 0–3.3 V; `analogReadMilliVolts()` gives millivolts.
  - **ADC2 pins (A0–A4, 11, 12, 13) don't work while WiFi is on.** WiFi projects should read analog values on A5 (GPIO 7) or pins 8–10 (ADC1).
- **PWM** (core 3.x API; the old 2.x channel API does not exist):
  ```cpp
  ledcAttach(pin, 5000, 8);   // pin, frequency Hz, resolution bits
  ledcWrite(pin, 128);        // duty 0–255 at 8 bits
  ```
  `analogWrite(pin, 0–255)` also works. For sound, use `tone(pin, freq)` / `noTone(pin)`, or `ledcAttach` + `ledcWriteTone(pin, freq)`.
- **Touch**: `touchRead(pin)` on GPIO 3, 4, 5 and 8–14.
- **Serial**: `Serial.begin(115200);`. USB serial is native, so text printed in the first moments after reset can be lost while USB reconnects. Repeat state periodically rather than printing it once in `setup()`. `Serial1` uses RX (38) / TX (39).

## I2C, Qwiic and the IMU

The I2C bus (SDA 3, SCL 4) and both Qwiic connectors get power from GPIO 6. Every I2C sketch starts like this (the tinyStudio examples do exactly this):

```cpp
#include <Wire.h>
#include <Adafruit_LSM6DSOX.h>

Adafruit_LSM6DSOX imu;

void setup() {
  Serial.begin(115200);
  pinMode(6, OUTPUT);        // PIN_I2C_POWER
  digitalWrite(6, HIGH);     // power the I2C bus / Qwiic
  delay(100);
  Wire.begin(3, 4);          // SDA, SCL
  if (!imu.begin_I2C()) {
    Serial.println("IMU not found");
    while (1) delay(10);
  }
}

void loop() {
  sensors_event_t accel, gyro, temp;
  imu.getEvent(&accel, &gyro, &temp);
  Serial.printf("ax:%.2f ay:%.2f az:%.2f\n",
                accel.acceleration.x, accel.acceleration.y, accel.acceleration.z);
  delay(50);
}
```

The IMU library is **Adafruit LSM6DS** (`Adafruit_LSM6DSOX.h`). OLED displays on Qwiic typically use **Adafruit SSD1306** + **Adafruit GFX**. If an I2C device isn't found, check the GPIO 6 line first.

## SD card

The slot is on the SPI pins (SCK 36, MOSI 35, MISO 37). The examples call `SD.begin()` with no arguments, which uses the board's default chip-select, `SS` = GPIO 1. Don't use GPIO 1 for anything else in a project that uses the card.

```cpp
#include "FS.h"
#include "SD.h"
#include "SPI.h"

if (!SD.begin()) Serial.println("SD card mount failed");
```

## WiFi and Bluetooth

Standard Arduino-ESP32 APIs work (`WiFi.h`, `WebServer.h`, `esp_now.h`, `BLEDevice.h`). Remember the ADC2 rule above.

## Add-on boards

MR.INDUSTRIES makes tinyHats: tinyGlow, tinySpeak, tinyProto, tinySniff. Each has its own pinout on tinydocs.cc. Don't guess which pins a hat uses: ask the user, or check the project's circuit with inspect_circuit.
