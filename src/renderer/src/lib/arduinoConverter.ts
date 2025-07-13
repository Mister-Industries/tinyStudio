import * as Blockly from 'blockly'
import { ArduinoGenerator } from './arduinoBlocks'

// Utility functions for converting between Arduino code and Blockly XML

/**
 * Converts Arduino code to Blockly XML format
 * This is a basic implementation - in a full system, you'd want more sophisticated parsing
 */
export function arduinoCodeToXml(arduinoCode: string): string {
  // For now, we'll create a basic structure based on common Arduino patterns
  // In a full implementation, you'd want to parse the Arduino code and convert it to blocks
  
  const lines = arduinoCode.split('\n')
  let setupBlocks = ''
  let loopBlocks = ''
  
  let inSetup = false
  let inLoop = false
  
  for (const line of lines) {
    const trimmedLine = line.trim()
    
    // Detect setup function
    if (trimmedLine.includes('void setup()')) {
      inSetup = true
      inLoop = false
      continue
    }
    
    // Detect loop function
    if (trimmedLine.includes('void loop()')) {
      inSetup = false
      inLoop = true
      continue
    }
    
    // Detect end of functions
    if (trimmedLine === '}') {
      inSetup = false
      inLoop = false
      continue
    }
    
    // Parse setup content
    if (inSetup && trimmedLine) {
      setupBlocks += parseArduinoLineToBlock(trimmedLine)
    }
    
    // Parse loop content
    if (inLoop && trimmedLine) {
      loopBlocks += parseArduinoLineToBlock(trimmedLine)
    }
  }
  
  // If no setup or loop blocks were found, create a default structure
  if (!setupBlocks && !loopBlocks) {
    return `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="arduino_setup" x="50" y="50">
        </block>
        <block type="arduino_loop" x="50" y="200">
        </block>
      </xml>
    `
  }
  
  return `
    <xml xmlns="https://developers.google.com/blockly/xml">
      <block type="arduino_setup" x="50" y="50">
        <next>
          ${setupBlocks}
        </next>
      </block>
      <block type="arduino_loop" x="50" y="200">
        <next>
          ${loopBlocks}
        </next>
      </block>
    </xml>
  `
}

/**
 * Parses a single Arduino line and converts it to Blockly XML
 */
function parseArduinoLineToBlock(line: string): string {
  const trimmedLine = line.trim()
  
  // Remove comments
  const codeLine = trimmedLine.split('//')[0].trim()
  if (!codeLine) return ''
  
  // Pin mode
  if (codeLine.includes('pinMode(')) {
    const match = codeLine.match(/pinMode\((\w+),\s*(\w+)\)/)
    if (match) {
      const pin = match[1]
      const mode = match[2]
      return `
        <block type="arduino_pin_mode">
          <field name="PIN">${pin}</field>
          <field name="MODE">${mode}</field>
          <next>
      `
    }
  }
  
  // Digital write
  if (codeLine.includes('digitalWrite(')) {
    const match = codeLine.match(/digitalWrite\((\w+),\s*(\w+)\)/)
    if (match) {
      const pin = match[1]
      const state = match[2]
      return `
        <block type="arduino_digital_write">
          <field name="PIN">${pin}</field>
          <field name="STATE">${state}</field>
          <next>
      `
    }
  }
  
  // Serial begin
  if (codeLine.includes('Serial.begin(')) {
    const match = codeLine.match(/Serial\.begin\((\d+)\)/)
    if (match) {
      const baud = match[1]
      return `
        <block type="arduino_serial_begin">
          <field name="BAUD">${baud}</field>
          <next>
      `
    }
  }
  
  // Serial print
  if (codeLine.includes('Serial.print(')) {
    const match = codeLine.match(/Serial\.print\("([^"]+)"\)/)
    if (match) {
      const text = match[1]
      return `
        <block type="arduino_serial_print">
          <field name="TEXT">${text}</field>
          <next>
      `
    }
  }
  
  // Serial println
  if (codeLine.includes('Serial.println(')) {
    const match = codeLine.match(/Serial\.println\("([^"]+)"\)/)
    if (match) {
      const text = match[1]
      return `
        <block type="arduino_serial_println">
          <field name="TEXT">${text}</field>
          <next>
      `
    }
  }
  
  // Delay
  if (codeLine.includes('delay(')) {
    const match = codeLine.match(/delay\((\d+)\)/)
    if (match) {
      const delay = match[1]
      return `
        <block type="arduino_delay">
          <field name="DELAY">${delay}</field>
          <next>
      `
    }
  }
  
  // Default: return empty string for unrecognized lines
  return ''
}

/**
 * Converts Blockly XML to Arduino code
 * This uses the existing ArduinoGenerator from arduinoBlocks.ts
 */
export function xmlToArduinoCode(xmlString: string, workspace: Blockly.WorkspaceSvg): string {
  try {
    const parser = new DOMParser()
    const xml = parser.parseFromString(xmlString, 'text/xml')
    
    // Clear workspace and load XML
    workspace.clear()
    Blockly.Xml.domToWorkspace(xml.documentElement, workspace)
    
    // Generate Arduino code
    return ArduinoGenerator.workspaceToCode(workspace)
  } catch (error) {
    console.error('Error converting XML to Arduino code:', error)
    return ''
  }
} 