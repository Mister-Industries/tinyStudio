/*
 * On the tinyCore
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/5_reference/basics/esp-now/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/esp-now-on-the-tinycore
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <esp_now.h>
#include <WiFi.h>

// Receiver's MAC address (get this from the other board)
uint8_t peerAddress[] = {0x30, 0xAE, 0xA4, 0x07, 0x0D, 0x64};

// Called when data is sent
void onSent(const uint8_t *mac, esp_now_send_status_t status) {
  Serial.println(status == ESP_NOW_SEND_SUCCESS ? "Delivered" : "Failed");
}

// Called when data is received
void onReceive(const uint8_t *mac, const uint8_t *data, int len) {
  Serial.print("Received: ");
  Serial.write(data, len);
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);  // must be in station mode

  esp_now_init();
  esp_now_register_send_cb(onSent);
  esp_now_register_recv_cb(onReceive);

  // Register the peer
  esp_now_peer_info_t peer;
  memcpy(peer.peer_addr, peerAddress, 6);
  peer.channel = 0;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
}

void loop() {
  const char *msg = "Hello from tinyCore!";
  esp_now_send(peerAddress, (uint8_t *)msg, strlen(msg));
  delay(2000);
}
