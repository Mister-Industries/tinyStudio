/*
 * The Complete Motion Tracker Code
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/1_get-started/motion-tracker/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/motion-tracker
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <Adafruit_LSM6DSOX.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <SD.h>
#include <SPI.h>

// WiFi credentials - Change these!
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";
const char* host_ip = "192.168.1.100"; // Your computer's IP
const int udp_port = 12345;

// Hardware setup
Adafruit_LSM6DSOX lsm6dsox;
WiFiUDP udp;
File dataFile;

// Timing and data
unsigned long lastSample = 0;
const unsigned long SAMPLE_INTERVAL = 50; // 20Hz sampling
unsigned long sessionStart;
int packetCount = 0;

// Simple moving average filter
struct MotionData {
  float accelX, accelY, accelZ;
  float gyroX, gyroY, gyroZ;
  float temp;
  unsigned long timestamp;
};

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("=== tinyCore Motion Tracker Starting ===");

  // Initialize IMU
  setupIMU();

  // Initialize SD Card  
  setupSDCard();

  // Connect to WiFi
  setupWiFi();

  sessionStart = millis();
  Serial.println("Motion tracker ready! Starting data collection...");
}

void setupIMU() {
  // IMU power and I2C setup
  pinMode(6, OUTPUT);
  digitalWrite(6, HIGH);
  Wire.begin(3, 4);
  delay(100);

  if (!lsm6dsox.begin_I2C()) {
    Serial.println("ERROR: IMU not found!");
    while(1) delay(10);
  }

  // Configure for motion tracking
  lsm6dsox.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);    // ±4g range
  lsm6dsox.setGyroRange(LSM6DS_GYRO_RANGE_500_DPS);  // ±500 degrees/sec
  lsm6dsox.setAccelDataRate(LSM6DS_RATE_104_HZ);
  lsm6dsox.setGyroDataRate(LSM6DS_RATE_104_HZ);

  Serial.println("✓ IMU initialized");
}

void setupSDCard() {
  if (!SD.begin()) {
    Serial.println("WARNING: SD Card not found - logging disabled");
    return;
  }

  // Create new session file
  String filename = "/motion_" + String(millis()) + ".csv";
  dataFile = SD.open(filename, FILE_WRITE);

  if (dataFile) {
    dataFile.println("timestamp,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,temp");
    dataFile.flush();
    Serial.println("✓ SD Card ready - " + filename);
  }
}

void setupWiFi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("✓ WiFi connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    udp.begin(udp_port);
  } else {
    Serial.println();
    Serial.println("WARNING: WiFi connection failed - streaming disabled");
  }
}

void loop() {
  unsigned long currentTime = millis();

  if (currentTime - lastSample >= SAMPLE_INTERVAL) {
    MotionData data = readMotionData();

    // Log to SD card
    logToSD(data);

    // Stream via WiFi
    streamData(data);

    lastSample = currentTime;
    packetCount++;

    // Status update every 5 seconds
    if (packetCount % 100 == 0) {
      Serial.println("Packets sent: " + String(packetCount));
    }
  }
}

MotionData readMotionData() {
  sensors_event_t accel, gyro, temp;
  lsm6dsox.getEvent(&accel, &gyro, &temp);

  MotionData data;
  data.accelX = accel.acceleration.x;
  data.accelY = accel.acceleration.y; 
  data.accelZ = accel.acceleration.z;
  data.gyroX = gyro.gyro.x;
  data.gyroY = gyro.gyro.y;
  data.gyroZ = gyro.gyro.z;
  data.temp = temp.temperature;
  data.timestamp = millis() - sessionStart;

  return data;
}

void logToSD(MotionData data) {
  if (!dataFile) return;

  dataFile.print(data.timestamp); dataFile.print(",");
  dataFile.print(data.accelX, 3); dataFile.print(",");
  dataFile.print(data.accelY, 3); dataFile.print(","); 
  dataFile.print(data.accelZ, 3); dataFile.print(",");
  dataFile.print(data.gyroX, 3); dataFile.print(",");
  dataFile.print(data.gyroY, 3); dataFile.print(",");
  dataFile.print(data.gyroZ, 3); dataFile.print(",");
  dataFile.println(data.temp, 1);

  // Flush every 10 samples to prevent data loss
  if (packetCount % 10 == 0) {
    dataFile.flush();
  }
}

void streamData(MotionData data) {
  if (WiFi.status() != WL_CONNECTED) return;

  // Create JSON packet for easy parsing
  String packet = "{";
  packet += "\"t\":" + String(data.timestamp) + ",";
  packet += "\"ax\":" + String(data.accelX, 3) + ",";
  packet += "\"ay\":" + String(data.accelY, 3) + ",";
  packet += "\"az\":" + String(data.accelZ, 3) + ",";
  packet += "\"gx\":" + String(data.gyroX, 3) + ",";
  packet += "\"gy\":" + String(data.gyroY, 3) + ",";
  packet += "\"gz\":" + String(data.gyroZ, 3) + ",";
  packet += "\"temp\":" + String(data.temp, 1);
  packet += "}";

  udp.beginPacket(host_ip, udp_port);
  udp.print(packet);
  udp.endPacket();
}
