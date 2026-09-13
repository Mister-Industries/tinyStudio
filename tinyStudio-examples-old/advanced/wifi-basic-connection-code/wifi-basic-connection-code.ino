/*
 * Basic Connection Code
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/advanced/wifi/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/advanced/wifi-basic-connection-code
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <WiFi.h>

const char* ssid = "YourNetwork";
const char* password = "YourPassword";

void setup() {
  Serial.begin(115200);
  delay(2000);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nConnected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  // your code here
}
