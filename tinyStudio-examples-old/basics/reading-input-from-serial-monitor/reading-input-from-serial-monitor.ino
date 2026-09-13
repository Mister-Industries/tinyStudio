/*
 * Reading input from Serial Monitor
 *
 * Board:  tinyCore (ESP32-S3)
 * Docs:   https://tinydocs.cc/2_tiny-core/basics/serial-monitor-plotter/
 * Studio: https://app.tinystudio.cc/Mister-Industries/tinyStudio-examples/basics/reading-input-from-serial-monitor
 *
 * Part of the MR.INDUSTRIES tinyStudio examples collection.
 * Generated from tinyDocs — edit the docs page, not this file.
 */

// Interactive Serial Commands

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);

  Serial.println("=== Interactive tinyCore Controller ===");
  Serial.println("Available commands:");
  Serial.println("  'on'    - Turn LED on");
  Serial.println("  'off'   - Turn LED off");
  Serial.println("  'blink' - Blink LED once");
  Serial.println("  'status'- Show current status");
  Serial.println("  'help'  - Show this menu");
  Serial.println("Type a command and press Enter:");
}

void loop() {
  // Check if data is available to read
  if (Serial.available()) {
    // Read the entire line until newline character
    String command = Serial.readStringUntil('\n');
    command.trim();  // Remove any extra whitespace

    // Convert to lowercase for easier comparison
    command.toLowerCase();

    Serial.print("Received command: '");
    Serial.print(command);
    Serial.println("'");

    // Process the command
    if (command == "on") {
      digitalWrite(LED_BUILTIN, HIGH);
      Serial.println("✓ LED turned ON");

    } else if (command == "off") {
      digitalWrite(LED_BUILTIN, LOW);
      Serial.println("✓ LED turned OFF");

    } else if (command == "blink") {
      Serial.println("✓ Blinking LED...");
      digitalWrite(LED_BUILTIN, HIGH);
      delay(300);
      digitalWrite(LED_BUILTIN, LOW);
      delay(300);
      Serial.println("✓ Blink complete");

    } else if (command == "status") {
      Serial.println("=== System Status ===");
      Serial.print("LED state: ");
      Serial.println(digitalRead(LED_BUILTIN) ? "ON" : "OFF");
      Serial.print("Uptime: ");
      Serial.print(millis() / 1000);
      Serial.println(" seconds");
      Serial.print("Free memory: ");
      Serial.print(ESP.getFreeHeap());
      Serial.println(" bytes");

    } else if (command == "help") {
      Serial.println("Available commands: on, off, blink, status, help");

    } else {
      Serial.print("❌ Unknown command: '");
      Serial.print(command);
      Serial.println("'");
      Serial.println("Type 'help' for available commands");
    }

    Serial.println("Enter next command:");
  }
}
