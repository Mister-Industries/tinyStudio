/*
 * MQTT Client
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/wifi/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/wifi-mqtt-client
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <WiFi.h>
#include <PubSubClient.h>

const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;
const char* mqtt_topic = "tinycore/sensors";

WiFiClient espClient;
PubSubClient client(espClient);

void setup() {
    // WiFi setup...

    client.setServer(mqtt_server, mqtt_port);
    client.setCallback(callback);
}

void loop() {
    if (!client.connected()) {
        reconnect();
    }
    client.loop();

    // Publish sensor data every 30 seconds
    static unsigned long lastMsg = 0;
    if (millis() - lastMsg > 30000) {
        lastMsg = millis();

        String data = "{\"temperature\":" + String(readTemperature()) + "}";
        client.publish(mqtt_topic, data.c_str());
    }
}

void callback(char* topic, byte* payload, unsigned int length) {
    String message = "";
    for (int i = 0; i < length; i++) {
        message += (char)payload[i];
    }

    Serial.print("Message received: ");
    Serial.println(message);
}

void reconnect() {
    while (!client.connected()) {
        Serial.print("Attempting MQTT connection...");
        String clientId = "tinyCore-";
        clientId += String(random(0xffff), HEX);

        if (client.connect(clientId.c_str())) {
            Serial.println("connected");
            client.subscribe("tinycore/commands");
        } else {
            Serial.print("failed, rc=");
            Serial.print(client.state());
            Serial.println(" retrying in 5 seconds");
            delay(5000);
        }
    }
}
