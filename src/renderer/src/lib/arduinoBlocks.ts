import * as Blockly from 'blockly'

// Define Arduino-specific blocks with comprehensive functionality
export function defineArduinoBlocks(): void {
  // Arduino Setup block
  Blockly.Blocks['arduino_setup'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('setup')
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Arduino setup function - runs once at startup')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/structure/sketch/setup/')
    }
  }

  // Arduino Loop block
  Blockly.Blocks['arduino_loop'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('loop')
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Arduino loop function - runs continuously')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/structure/sketch/loop/')
    }
  }

  // Pin Mode block
  Blockly.Blocks['arduino_pin_mode'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('pinMode')
        .appendField(new Blockly.FieldNumber(13, 0, 53), 'PIN')
        .appendField(new Blockly.FieldDropdown([
          ['INPUT', 'INPUT'],
          ['OUTPUT', 'OUTPUT'],
          ['INPUT_PULLUP', 'INPUT_PULLUP']
        ]), 'MODE')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Configure pin as input or output')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/digital-io/pinmode/')
    }
  }

  // Digital Write block
  Blockly.Blocks['arduino_digital_write'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('digitalWrite')
        .appendField(new Blockly.FieldNumber(13, 0, 53), 'PIN')
        .appendField(new Blockly.FieldDropdown([
          ['HIGH', 'HIGH'],
          ['LOW', 'LOW']
        ]), 'STATE')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Write HIGH or LOW to a digital pin')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/digital-io/digitalwrite/')
    }
  }

  // Digital Read block
  Blockly.Blocks['arduino_digital_read'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('digitalRead')
        .appendField(new Blockly.FieldNumber(13, 0, 53), 'PIN')
      this.setOutput(true, 'Boolean')
      this.setColour(60)
      this.setTooltip('Read HIGH or LOW from a digital pin')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/digital-io/digitalread/')
    }
  }

  // Analog Read block
  Blockly.Blocks['arduino_analog_read'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('analogRead')
        .appendField(new Blockly.FieldNumber(0, 0, 5), 'PIN')
      this.setOutput(true, 'Number')
      this.setColour(60)
      this.setTooltip('Read analog value (0-1023) from analog pin')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/analog-io/analogread/')
    }
  }

  // Analog Write block
  Blockly.Blocks['arduino_analog_write'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('analogWrite')
        .appendField(new Blockly.FieldNumber(9, 0, 13), 'PIN')
        .appendField(new Blockly.FieldNumber(128, 0, 255), 'VALUE')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Write analog value (0-255) to PWM pin')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/analog-io/analogwrite/')
    }
  }

  // Delay block
  Blockly.Blocks['arduino_delay'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('delay')
        .appendField(new Blockly.FieldNumber(1000, 0, 60000), 'DELAY')
        .appendField('ms')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Pause for specified milliseconds')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/time/delay/')
    }
  }

  // Serial Begin block
  Blockly.Blocks['arduino_serial_begin'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('Serial.begin')
        .appendField(new Blockly.FieldDropdown([
          ['9600', '9600'],
          ['19200', '19200'],
          ['38400', '38400'],
          ['57600', '57600'],
          ['115200', '115200']
        ]), 'BAUD')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Initialize serial communication')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/communication/serial/begin/')
    }
  }

  // Serial Print block
  Blockly.Blocks['arduino_serial_print'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('Serial.print')
        .appendField(new Blockly.FieldTextInput('Hello World'), 'TEXT')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Print text to serial monitor')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/communication/serial/print/')
    }
  }

  // Serial Println block
  Blockly.Blocks['arduino_serial_println'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('Serial.println')
        .appendField(new Blockly.FieldTextInput('Hello World'), 'TEXT')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Print text to serial monitor with newline')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/communication/serial/println/')
    }
  }

  // Millis block
  Blockly.Blocks['arduino_millis'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('millis')
      this.setOutput(true, 'Number')
      this.setColour(60)
      this.setTooltip('Get milliseconds since program started')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/time/millis/')
    }
  }

  // Map block
  Blockly.Blocks['arduino_map'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('map')
        .appendField(new Blockly.FieldNumber(0, 0, 1023), 'VALUE')
        .appendField('from')
        .appendField(new Blockly.FieldNumber(0, 0, 1023), 'FROM_LOW')
        .appendField('to')
        .appendField(new Blockly.FieldNumber(1023, 0, 1023), 'FROM_HIGH')
        .appendField('out')
        .appendField(new Blockly.FieldNumber(0, 0, 255), 'TO_LOW')
        .appendField('to')
        .appendField(new Blockly.FieldNumber(255, 0, 255), 'TO_HIGH')
      this.setOutput(true, 'Number')
      this.setColour(60)
      this.setTooltip('Map a value from one range to another')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/math/map/')
    }
  }

  // Constrain block
  Blockly.Blocks['arduino_constrain'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('constrain')
        .appendField(new Blockly.FieldNumber(0, 0, 1023), 'VALUE')
        .appendField('between')
        .appendField(new Blockly.FieldNumber(0, 0, 255), 'LOW')
        .appendField('and')
        .appendField(new Blockly.FieldNumber(255, 0, 255), 'HIGH')
      this.setOutput(true, 'Number')
      this.setColour(60)
      this.setTooltip('Constrain a value between min and max')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/math/constrain/')
    }
  }

  // Random block
  Blockly.Blocks['arduino_random'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('random')
        .appendField(new Blockly.FieldNumber(0, 0, 1000), 'MIN')
        .appendField('to')
        .appendField(new Blockly.FieldNumber(100, 0, 1000), 'MAX')
      this.setOutput(true, 'Number')
      this.setColour(60)
      this.setTooltip('Generate random number between min and max')
      this.setHelpUrl('https://www.arduino.cc/reference/en/language/functions/random-numbers/random/')
    }
  }

  // Servo block
  Blockly.Blocks['arduino_servo_write'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('servo.write')
        .appendField(new Blockly.FieldTextInput('myservo'), 'SERVO')
        .appendField('to')
        .appendField(new Blockly.FieldNumber(90, 0, 180), 'ANGLE')
        .appendField('degrees')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Set servo motor angle (0-180 degrees)')
      this.setHelpUrl('https://www.arduino.cc/reference/en/libraries/servo/write/')
    }
  }

  // LCD block
  Blockly.Blocks['arduino_lcd_print'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('lcd.print')
        .appendField(new Blockly.FieldTextInput('Hello'), 'TEXT')
        .appendField('at')
        .appendField(new Blockly.FieldNumber(0, 0, 15), 'COL')
        .appendField(',')
        .appendField(new Blockly.FieldNumber(0, 0, 1), 'ROW')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Print text to LCD display')
      this.setHelpUrl('')
    }
  }

  // Ultrasonic block
  Blockly.Blocks['arduino_ultrasonic_read'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('ultrasonic.read')
        .appendField(new Blockly.FieldNumber(2, 0, 13), 'TRIG_PIN')
        .appendField(',')
        .appendField(new Blockly.FieldNumber(3, 0, 13), 'ECHO_PIN')
      this.setOutput(true, 'Number')
      this.setColour(60)
      this.setTooltip('Read distance from ultrasonic sensor (cm)')
      this.setHelpUrl('')
    }
  }

  // Motor block
  Blockly.Blocks['arduino_motor_control'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('motor')
        .appendField(new Blockly.FieldNumber(5, 0, 13), 'PIN1')
        .appendField(',')
        .appendField(new Blockly.FieldNumber(6, 0, 13), 'PIN2')
        .appendField(new Blockly.FieldDropdown([
          ['FORWARD', 'FORWARD'],
          ['BACKWARD', 'BACKWARD'],
          ['STOP', 'STOP']
        ]), 'DIRECTION')
        .appendField('speed')
        .appendField(new Blockly.FieldNumber(255, 0, 255), 'SPEED')
      this.setPreviousStatement(true)
      this.setNextStatement(true)
      this.setColour(60)
      this.setTooltip('Control DC motor direction and speed')
      this.setHelpUrl('')
    }
  }
}

// Create our own Arduino code generator
export const ArduinoGenerator = new Blockly.Generator('Arduino')

// Define Arduino code generators
export function defineArduinoGenerators(): void {
  // Arduino Setup generator
  ArduinoGenerator['arduino_setup'] = function(block: Blockly.Block) {
    const statements = ArduinoGenerator.statementToCode(block, 'DO')
    return 'void setup() {\n' + statements + '}\n'
  }

  // Arduino Loop generator
  ArduinoGenerator['arduino_loop'] = function(block: Blockly.Block) {
    const statements = ArduinoGenerator.statementToCode(block, 'DO')
    return 'void loop() {\n' + statements + '}\n'
  }

  // Pin Mode generator
  ArduinoGenerator['arduino_pin_mode'] = function(block: Blockly.Block) {
    const pin = block.getFieldValue('PIN')
    const mode = block.getFieldValue('MODE')
    return `pinMode(${pin}, ${mode});\n`
  }

  // Digital Write generator
  ArduinoGenerator['arduino_digital_write'] = function(block: Blockly.Block) {
    const pin = block.getFieldValue('PIN')
    const state = block.getFieldValue('STATE')
    return `digitalWrite(${pin}, ${state});\n`
  }

  // Digital Read generator
  ArduinoGenerator['arduino_digital_read'] = function(block: Blockly.Block) {
    const pin = block.getFieldValue('PIN')
    return `digitalRead(${pin})`
  }

  // Analog Read generator
  ArduinoGenerator['arduino_analog_read'] = function(block: Blockly.Block) {
    const pin = block.getFieldValue('PIN')
    return `analogRead(${pin})`
  }

  // Analog Write generator
  ArduinoGenerator['arduino_analog_write'] = function(block: Blockly.Block) {
    const pin = block.getFieldValue('PIN')
    const value = block.getFieldValue('VALUE')
    return `analogWrite(${pin}, ${value});\n`
  }

  // Delay generator
  ArduinoGenerator['arduino_delay'] = function(block: Blockly.Block) {
    const delay = block.getFieldValue('DELAY')
    return `delay(${delay});\n`
  }

  // Serial Begin generator
  ArduinoGenerator['arduino_serial_begin'] = function(block: Blockly.Block) {
    const baud = block.getFieldValue('BAUD')
    return `Serial.begin(${baud});\n`
  }

  // Serial Print generator
  ArduinoGenerator['arduino_serial_print'] = function(block: Blockly.Block) {
    const text = block.getFieldValue('TEXT')
    return `Serial.print("${text}");\n`
  }

  // Serial Println generator
  ArduinoGenerator['arduino_serial_println'] = function(block: Blockly.Block) {
    const text = block.getFieldValue('TEXT')
    return `Serial.println("${text}");\n`
  }

  // Millis generator
  ArduinoGenerator['arduino_millis'] = function() {
    return 'millis()'
  }

  // Map generator
  ArduinoGenerator['arduino_map'] = function(block: Blockly.Block) {
    const value = block.getFieldValue('VALUE')
    const fromLow = block.getFieldValue('FROM_LOW')
    const fromHigh = block.getFieldValue('FROM_HIGH')
    const toLow = block.getFieldValue('TO_LOW')
    const toHigh = block.getFieldValue('TO_HIGH')
    return `map(${value}, ${fromLow}, ${fromHigh}, ${toLow}, ${toHigh})`
  }

  // Constrain generator
  ArduinoGenerator['arduino_constrain'] = function(block: Blockly.Block) {
    const value = block.getFieldValue('VALUE')
    const low = block.getFieldValue('LOW')
    const high = block.getFieldValue('HIGH')
    return `constrain(${value}, ${low}, ${high})`
  }

  // Random generator
  ArduinoGenerator['arduino_random'] = function(block: Blockly.Block) {
    const min = block.getFieldValue('MIN')
    const max = block.getFieldValue('MAX')
    return `random(${min}, ${max})`
  }

  // Servo generator
  ArduinoGenerator['arduino_servo_write'] = function(block: Blockly.Block) {
    const servo = block.getFieldValue('SERVO')
    const angle = block.getFieldValue('ANGLE')
    return `${servo}.write(${angle});\n`
  }

  // LCD generator
  ArduinoGenerator['arduino_lcd_print'] = function(block: Blockly.Block) {
    const text = block.getFieldValue('TEXT')
    const col = block.getFieldValue('COL')
    const row = block.getFieldValue('ROW')
    return `lcd.setCursor(${col}, ${row});\nlcd.print("${text}");\n`
  }

  // Ultrasonic generator
  ArduinoGenerator['arduino_ultrasonic_read'] = function(block: Blockly.Block) {
    const trigPin = block.getFieldValue('TRIG_PIN')
    const echoPin = block.getFieldValue('ECHO_PIN')
    return `getDistance(${trigPin}, ${echoPin})`
  }

  // Motor generator
  ArduinoGenerator['arduino_motor_control'] = function(block: Blockly.Block) {
    const pin1 = block.getFieldValue('PIN1')
    const pin2 = block.getFieldValue('PIN2')
    const direction = block.getFieldValue('DIRECTION')
    const speed = block.getFieldValue('SPEED')
    
    if (direction === 'FORWARD') {
      return `analogWrite(${pin1}, ${speed});\ndigitalWrite(${pin2}, LOW);\n`
    } else if (direction === 'BACKWARD') {
      return `digitalWrite(${pin1}, LOW);\nanalogWrite(${pin2}, ${speed});\n`
    } else {
      return `digitalWrite(${pin1}, LOW);\ndigitalWrite(${pin2}, LOW);\n`
    }
  }
} 