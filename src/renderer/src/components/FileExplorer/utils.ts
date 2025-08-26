/**
 * Utility functions for FileExplorer components
 * Contains helper functions for file operations, sorting, and icons
 */

import { fileSystem } from '../../lib/fileSystem'

/**
 * Get icon type for a file based on its name and type
 * @param fileName - Name of the file
 * @param isDirectory - Whether the item is a directory
 * @returns Icon type identifier
 */
export function getFileIconType(fileName: string | null): 'image' | 'code' | 'file' {
  if (!fileName) return 'file'

  // Check if file is an image
  if (fileSystem.isImageFile(fileName)) {
    return 'image'
  }

  // Check if file is a code file
  if (fileSystem.isCodeFile(fileName)) {
    return 'code'
  }

  // Default file type
  return 'file'
}

/**
 * Create default project files for a new Arduino project
 * @param projectTitle - The title of the project
 * @returns Array of file objects with path and content
 */
export function createDefaultProjectFiles(
  projectTitle: string
): Array<{ path: string; content: string }> {
  return [
    {
      path: 'README.md',
      content: `# ${projectTitle}

A tinyCore project created with TinyForge.

## Getting Started

1. Open this project in TinyForge
2. Connect your tinyCore
3. Upload the sketch to your board

## Hardware Requirements

- tinyCore (or compatible board)
- USB cable
- Additional components as needed

## Circuit Diagram

Add your circuit diagram and connections here.
`
    },
    {
      path: `${projectTitle.replace(/\s+/g, '_')}.ino`,
      content: `/*
  ${projectTitle}
  
  Created with TinyForge
  Date: ${new Date().toLocaleDateString()}
  
  Description:
  A basic sketch template. Customize this code for your project needs.
*/

// Pin definitions
const int LED_PIN = 13;  // Built-in LED pin

void setup() {
  // Initialize serial communication
  Serial.begin(9600);
  
  // Initialize digital pin LED_PIN as an output
  pinMode(LED_PIN, OUTPUT);
  
  Serial.println("${projectTitle} - Setup complete!");
}

void loop() {
  // Turn the LED on
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED ON");
  delay(1000);  // Wait for a second
  
  // Turn the LED off
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED OFF");
  delay(1000);  // Wait for a second
}
`
    }
  ]
}

/**
 * Generate a random project placeholder name
 * @returns A random project name from predefined list
 */
export function getRandomProjectPlaceholder(): string {
  const placeholders = [
    'Long Distance Message Box',
    'fNIRS Headset',
    'Punch-It!',
    'CyberJacket',
    'Smart Graduation Cap'
  ]
  return placeholders[Math.floor(Math.random() * placeholders.length)]
}
