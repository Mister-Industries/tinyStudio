/*
 * Basic Web Server
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/wifi/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/wifi-basic-web-server
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

#include <WiFi.h>
#include <WebServer.h>

const char* ssid = "YourWiFiNetwork";
const char* password = "YourWiFiPassword";

WebServer server(80);

void setup() {
    Serial.begin(115200);

    // Connect to WiFi
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println("");
    Serial.println("WiFi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());

    // Setup web server routes
    server.on("/", handleRoot);
    server.on("/led", handleLED);
    server.on("/sensor", handleSensor);

    server.begin();
    Serial.println("HTTP server started");
}

void loop() {
    server.handleClient();
}

void handleRoot() {
    String html = "<html><body>";
    html += "<h1>tinyCore Web Server</h1>";
    html += "<p><a href='/led'>Control LED</a></p>";
    html += "<p><a href='/sensor'>Sensor Data</a></p>";
    html += "</body></html>";

    server.send(200, "text/html", html);
}

void handleLED() {
    String state = server.hasArg("state") ? server.arg("state") : "";

    if (state == "on") {
        digitalWrite(LED_BUILTIN, HIGH);
        server.send(200, "text/plain", "LED ON");
    } else if (state == "off") {
        digitalWrite(LED_BUILTIN, LOW);
        server.send(200, "text/plain", "LED OFF");
    } else {
        server.send(400, "text/plain", "Invalid state");
    }
}

void handleSensor() {
    // Read sensor data
    float temperature = readTemperature();
    float humidity = readHumidity();

    String json = "{";
    json += "\"temperature\":" + String(temperature) + ",";
    json += "\"humidity\":" + String(humidity);
    json += "}";

    server.send(200, "application/json", json);
}
