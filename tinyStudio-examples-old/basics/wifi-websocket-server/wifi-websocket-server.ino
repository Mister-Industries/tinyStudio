/*
 * WebSocket Server
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/wifi/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/wifi-websocket-server
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <WiFi.h>
#include <WebSocketsServer.h>

WebSocketsServer webSocket = WebSocketsServer(81);

void setup() {
    // WiFi setup...

    webSocket.begin();
    webSocket.onEvent(webSocketEvent);
}

void loop() {
    webSocket.loop();

    // Send real-time sensor data
    static unsigned long lastUpdate = 0;
    if (millis() - lastUpdate > 1000) {
        lastUpdate = millis();

        String data = "{\"temperature\":" + String(readTemperature()) + "}";
        webSocket.broadcastTXT(data);
    }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
    switch(type) {
        case WStype_DISCONNECTED:
            Serial.printf("[%u] Disconnected!\n", num);
            break;
        case WStype_CONNECTED:
            Serial.printf("[%u] Connected!\n", num);
            break;
        case WStype_TEXT:
            // Handle incoming messages
            String message = String((char*)payload);
            Serial.println("Received: " + message);
            break;
    }
}
