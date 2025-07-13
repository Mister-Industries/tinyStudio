import { useEffect, useRef } from 'react'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import 'blockly/javascript'
import { useTheme } from '@renderer/lib/ThemeProvider'

interface BlocklyEditorProps {
  content: string
  initialBlocks?: string
  onContentChange: (code: string, xml: string) => void
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function BlocklyEditor({ content: _content, initialBlocks, onContentChange }: BlocklyEditorProps): React.JSX.Element {
  const blocklyDivRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const { theme } = useTheme()

  useEffect(() => {
    if (!blocklyDivRef.current) return

    // Custom Arduino blocks configuration
    const toolbox = {
      kind: 'categoryToolbox',
      contents: [
        {
          kind: 'category',
          name: 'Arduino',
          colour: '#A8E6CF',
          contents: [
            {
              kind: 'block',
              type: 'arduino_setup'
            },
            {
              kind: 'block',
              type: 'arduino_loop'
            },
            {
              kind: 'block',
              type: 'arduino_serial_begin'
            },
            {
              kind: 'block',
              type: 'arduino_serial_print'
            },
            {
              kind: 'block',
              type: 'arduino_serial_println'
            }
          ]
        },
        {
          kind: 'category',
          name: 'Digital I/O',
          colour: '#FFB6E1',
          contents: [
            {
              kind: 'block',
              type: 'arduino_pin_mode'
            },
            {
              kind: 'block',
              type: 'arduino_digital_write'
            },
            {
              kind: 'block',
              type: 'arduino_digital_read'
            },
            {
              kind: 'block',
              type: 'arduino_led_on'
            },
            {
              kind: 'block',
              type: 'arduino_led_off'
            }
          ]
        },
        {
          kind: 'category',
          name: 'Analog I/O',
          colour: '#DDA0DD',
          contents: [
            {
              kind: 'block',
              type: 'arduino_analog_read'
            },
            {
              kind: 'block',
              type: 'arduino_analog_write'
            },
            {
              kind: 'block',
              type: 'arduino_tone'
            }
          ]
        },
        {
          kind: 'category',
          name: 'Time',
          colour: '#F0E68C',
          contents: [
            {
              kind: 'block',
              type: 'arduino_delay'
            },
            {
              kind: 'block',
              type: 'arduino_delay_microseconds'
            },
            {
              kind: 'block',
              type: 'arduino_millis'
            }
          ]
        },
        {
          kind: 'category',
          name: 'Control',
          colour: '#FFB6C1',
          contents: [
            {
              kind: 'block',
              type: 'controls_if'
            },
            {
              kind: 'block',
              type: 'controls_repeat_ext'
            },
            {
              kind: 'block',
              type: 'controls_whileUntil'
            },
            {
              kind: 'block',
              type: 'controls_for'
            }
          ]
        },
        {
          kind: 'category',
          name: 'Logic',
          colour: '#87CEEB',
          contents: [
            {
              kind: 'block',
              type: 'logic_compare'
            },
            {
              kind: 'block',
              type: 'logic_operation'
            },
            {
              kind: 'block',
              type: 'logic_negate'
            },
            {
              kind: 'block',
              type: 'logic_boolean'
            }
          ]
        },
        {
          kind: 'category',
          name: 'Math',
          colour: '#98FB98',
          contents: [
            {
              kind: 'block',
              type: 'math_number'
            },
            {
              kind: 'block',
              type: 'math_arithmetic'
            },
            {
              kind: 'block',
              type: 'math_single'
            },
            {
              kind: 'block',
              type: 'math_random_int'
            }
          ]
        },
        {
          kind: 'category',
          name: 'Variables',
          colour: '#FFDAB9',
          contents: [
            {
              kind: 'block',
              type: 'text_string'
            },
            {
              kind: 'block',
              type: 'text'
            },
            {
              kind: 'block',
              type: 'math_number'
            }
          ]
        },
        {
          kind: 'category',
          name: 'Functions',
          colour: '#E6E6FA',
          custom: 'PROCEDURE'
        }
      ]
    }

    // Define custom Arduino blocks
    Blockly.defineBlocksWithJsonArray([
      // Arduino Core
      {
        type: 'arduino_setup',
        message0: 'setup() %1',
        args0: [{ type: 'input_statement', name: 'SETUP_CODE' }],
        colour: '#A8E6CF',
        tooltip: 'Arduino setup function - runs once'
      },
      {
        type: 'arduino_loop',
        message0: 'loop() %1',
        args0: [{ type: 'input_statement', name: 'LOOP_CODE' }],
        colour: '#A8E6CF',
        tooltip: 'Arduino loop function - runs repeatedly'
      },
      {
        type: 'arduino_serial_begin',
        message0: 'Serial.begin(%1)',
        args0: [{ type: 'field_number', name: 'BAUD', value: 9600 }],
        previousStatement: null,
        nextStatement: null,
        colour: '#A8E6CF',
        tooltip: 'Initialize serial communication'
      },
      {
        type: 'arduino_serial_print',
        message0: 'Serial.print(%1)',
        args0: [{ type: 'input_value', name: 'TEXT', check: ['String', 'Number'] }],
        previousStatement: null,
        nextStatement: null,
        colour: '#A8E6CF',
        tooltip: 'Print to serial monitor'
      },
      {
        type: 'arduino_serial_println',
        message0: 'Serial.println(%1)',
        args0: [{ type: 'input_value', name: 'TEXT', check: ['String', 'Number'] }],
        previousStatement: null,
        nextStatement: null,
        colour: '#A8E6CF',
        tooltip: 'Print line to serial monitor'
      },
      // Digital I/O
      {
        type: 'arduino_pin_mode',
        message0: 'pinMode(%1, %2)',
        args0: [
          { type: 'field_number', name: 'PIN', value: 13, min: 0, max: 53 },
          { type: 'field_dropdown', name: 'MODE', options: [['OUTPUT', 'OUTPUT'], ['INPUT', 'INPUT'], ['INPUT_PULLUP', 'INPUT_PULLUP']] }
        ],
        previousStatement: null,
        nextStatement: null,
        colour: '#FFB6E1',
        tooltip: 'Set pin mode'
      },
      {
        type: 'arduino_digital_write',
        message0: 'digitalWrite(%1, %2)',
        args0: [
          { type: 'field_number', name: 'PIN', value: 13, min: 0, max: 53 },
          { type: 'field_dropdown', name: 'STATE', options: [['HIGH', 'HIGH'], ['LOW', 'LOW']] }
        ],
        previousStatement: null,
        nextStatement: null,
        colour: '#FFB6E1',
        tooltip: 'Write digital value to pin'
      },
      {
        type: 'arduino_digital_read',
        message0: 'digitalRead(%1)',
        args0: [{ type: 'field_number', name: 'PIN', value: 2, min: 0, max: 53 }],
        output: 'Boolean',
        colour: '#FFB6E1',
        tooltip: 'Read digital value from pin'
      },
      {
        type: 'arduino_led_on',
        message0: 'turn LED %1 ON',
        args0: [{ type: 'field_number', name: 'PIN', value: 13, min: 0, max: 53 }],
        previousStatement: null,
        nextStatement: null,
        colour: '#FFB6E1',
        tooltip: 'Turn LED on'
      },
      {
        type: 'arduino_led_off',
        message0: 'turn LED %1 OFF',
        args0: [{ type: 'field_number', name: 'PIN', value: 13, min: 0, max: 53 }],
        previousStatement: null,
        nextStatement: null,
        colour: '#FFB6E1',
        tooltip: 'Turn LED off'
      },
      // Analog I/O
      {
        type: 'arduino_analog_read',
        message0: 'analogRead(%1)',
        args0: [{ type: 'field_number', name: 'PIN', value: 0, min: 0, max: 5 }],
        output: 'Number',
        colour: '#DDA0DD',
        tooltip: 'Read analog value (0-1023)'
      },
      {
        type: 'arduino_analog_write',
        message0: 'analogWrite(%1, %2)',
        args0: [
          { type: 'field_number', name: 'PIN', value: 9, min: 0, max: 53 },
          { type: 'input_value', name: 'VALUE', check: 'Number' }
        ],
        previousStatement: null,
        nextStatement: null,
        colour: '#DDA0DD',
        tooltip: 'Write analog value (0-255)'
      },
      {
        type: 'arduino_tone',
        message0: 'tone(%1, %2)',
        args0: [
          { type: 'field_number', name: 'PIN', value: 8, min: 0, max: 53 },
          { type: 'input_value', name: 'FREQUENCY', check: 'Number' }
        ],
        previousStatement: null,
        nextStatement: null,
        colour: '#DDA0DD',
        tooltip: 'Generate tone'
      },
      // Time
      {
        type: 'arduino_delay',
        message0: 'delay(%1) ms',
        args0: [{ type: 'field_number', name: 'TIME', value: 1000, min: 0 }],
        previousStatement: null,
        nextStatement: null,
        colour: '#F0E68C',
        tooltip: 'Wait for specified milliseconds'
      },
      {
        type: 'arduino_delay_microseconds',
        message0: 'delayMicroseconds(%1)',
        args0: [{ type: 'field_number', name: 'TIME', value: 1000, min: 0 }],
        previousStatement: null,
        nextStatement: null,
        colour: '#F0E68C',
        tooltip: 'Wait for specified microseconds'
      },
      {
        type: 'arduino_millis',
        message0: 'millis()',
        output: 'Number',
        colour: '#F0E68C',
        tooltip: 'Get milliseconds since start'
      },
      // Text blocks for Variables
      {
        type: 'text_string',
        message0: '"%1"',
        args0: [{ type: 'field_input', name: 'TEXT', text: 'Hello Arduino!' }],
        output: 'String',
        colour: '#FFDAB9',
        tooltip: 'Text string'
      }
    ])

    workspaceRef.current = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolbox,
      grid: {
        spacing: 20,
        length: 3,
        colour: theme === 'dark' ? '#444' : '#e0e0e0',
        snap: true
      },
      zoom: {
        controls: true,
        wheel: true,
        startScale: 1.0,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.2
      },
      trashcan: true,
      scrollbars: {
        horizontal: true,
        vertical: true
      },
      move: {
        scrollbars: true,
        drag: true,
        wheel: true
      },
      sounds: false,
      disable: false,
      readOnly: false,
      theme: {
        name: 'tinyStudio',
        base: Blockly.Themes.Classic,
        componentStyles: {
          'workspaceBackgroundColour': theme === 'dark' ? '#1e1e1e' : '#f8fcff',
          'toolboxBackgroundColour': theme === 'dark' ? '#2d2d2d' : '#f0f8fc',
          'flyoutBackgroundColour': theme === 'dark' ? '#3d3d3d' : '#ffffff',
          'scrollbarColour': '#c8c8c8',
          'insertionMarkerColour': '#fff',
          'scrollbarOpacity': 0.4,
          'cursorColour': '#d0d0d0'
        },
        fontStyle: {
          'family': '"Fira Code", "JetBrains Mono", Consolas, Monaco, monospace',
          'weight': 'normal',
          'size': 12
        }
      }
    })

    // Listen for changes and generate Arduino code
    workspaceRef.current.addChangeListener((event) => {
      if (workspaceRef.current) {
        // Only update content for certain event types to avoid infinite loops
        if (event.type === Blockly.Events.BLOCK_CHANGE || 
            event.type === Blockly.Events.BLOCK_CREATE || 
            event.type === Blockly.Events.BLOCK_DELETE ||
            event.type === Blockly.Events.BLOCK_MOVE) {
          const code = generateArduinoCode(workspaceRef.current)
          const xml = Blockly.Xml.workspaceToDom(workspaceRef.current)
          const xmlText = Blockly.Xml.domToPrettyText(xml)
          onContentChange(code, xmlText)
        }
      }
    })

    // Add specific event listeners for better drag and drop
    workspaceRef.current.addChangeListener((event) => {
      if (event.type === Blockly.Events.BLOCK_MOVE) {
        // Ensure proper rendering after block moves
        setTimeout(() => {
          workspaceRef.current?.render()
        }, 10)
      }
    })

    // Add mouse event listeners for better drag behavior
    workspaceRef.current.addChangeListener((event) => {
      if (event.type === Blockly.Events.BLOCK_DRAG) {
        // Force workspace to update during drag
        workspaceRef.current?.render()
      }
    })

    // Load initial blocks if provided
    if (initialBlocks) {
      try {
        const xml = Blockly.utils.xml.textToDom(initialBlocks)
        Blockly.Xml.domToWorkspace(xml, workspaceRef.current)
      } catch (e) {
        console.warn('Could not load initial blocks:', e)
      }
    }

    // Cleanup function
    return () => {
      if (workspaceRef.current) {
        workspaceRef.current.dispose()
      }
    }
  }, [theme, onContentChange])

  const generateArduinoCode = (workspace: Blockly.WorkspaceSvg): string => {
    let setupCode = ''
    let loopCode = ''
    const variableDeclarations = ''

    const blocks = workspace.getAllBlocks()
    
    blocks.forEach(block => {
      if (block.type === 'arduino_setup') {
        setupCode = getStatementCode(block, 'SETUP_CODE')
      } else if (block.type === 'arduino_loop') {
        loopCode = getStatementCode(block, 'LOOP_CODE')
      }
    })

    return `${variableDeclarations}
void setup() {
  Serial.begin(9600);${setupCode ? '\n  ' + setupCode.split('\n').join('\n  ') : ''}
}

void loop() {${loopCode ? '\n  ' + loopCode.split('\n').join('\n  ') : ''}
}`
  }

  const getStatementCode = (block: Blockly.Block, inputName: string): string => {
    let code = ''
    let currentBlock = block.getInputTargetBlock(inputName)
    
    while (currentBlock) {
      code += convertBlockToCode(currentBlock) + '\n'
      currentBlock = currentBlock.getNextBlock()
    }
    
    return code.trim()
  }

  const convertBlockToCode = (block: Blockly.Block): string => {
    switch (block.type) {
      // Arduino Core
      case 'arduino_serial_begin': {
        const baud = block.getFieldValue('BAUD')
        return `Serial.begin(${baud});`
      }
      
      case 'arduino_serial_print': {
        const textInput = block.getInput('TEXT')
        if (textInput?.connection?.targetBlock()) {
          const textBlock = textInput.connection.targetBlock()
          if (textBlock?.type === 'text_string') {
            const textValue = textBlock.getFieldValue('TEXT')
            return `Serial.print("${textValue}");`
          } else if (textBlock?.type === 'text') {
            const textValue = textBlock.getFieldValue('TEXT')
            return `Serial.print("${textValue}");`
          } else if (textBlock?.type === 'math_number') {
            const numValue = textBlock.getFieldValue('NUM')
            return `Serial.print(${numValue});`
          }
        }
        return `Serial.print("Hello World");`
      }
      
      case 'arduino_serial_println': {
        const printlnInput = block.getInput('TEXT')
        if (printlnInput?.connection?.targetBlock()) {
          const textBlock = printlnInput.connection.targetBlock()
          if (textBlock?.type === 'text_string') {
            const textValue = textBlock.getFieldValue('TEXT')
            return `Serial.println("${textValue}");`
          } else if (textBlock?.type === 'text') {
            const textValue = textBlock.getFieldValue('TEXT')
            return `Serial.println("${textValue}");`
          } else if (textBlock?.type === 'math_number') {
            const numValue = textBlock.getFieldValue('NUM')
            return `Serial.println(${numValue});`
          }
        }
        return `Serial.println("Hello World");`
      }
      
      // Digital I/O
      case 'arduino_pin_mode': {
        const pinModePin = block.getFieldValue('PIN')
        const mode = block.getFieldValue('MODE')
        return `pinMode(${pinModePin}, ${mode});`
      }
      
      case 'arduino_digital_write': {
        const digitalPin = block.getFieldValue('PIN')
        const state = block.getFieldValue('STATE')
        return `digitalWrite(${digitalPin}, ${state});`
      }
      
      case 'arduino_digital_read': {
        const readPin = block.getFieldValue('PIN')
        return `digitalRead(${readPin})`
      }
      
      case 'arduino_led_on': {
        const pinOn = block.getFieldValue('PIN')
        return `pinMode(${pinOn}, OUTPUT);\ndigitalWrite(${pinOn}, HIGH);`
      }
      
      case 'arduino_led_off': {
        const pinOff = block.getFieldValue('PIN')
        return `digitalWrite(${pinOff}, LOW);`
      }
      
      // Analog I/O
      case 'arduino_analog_read': {
        const analogPin = block.getFieldValue('PIN')
        return `analogRead(${analogPin})`
      }
      
      case 'arduino_analog_write': {
        const analogWritePin = block.getFieldValue('PIN')
        return `analogWrite(${analogWritePin}, 128);`
      }
      
      case 'arduino_tone': {
        const tonePin = block.getFieldValue('PIN')
        return `tone(${tonePin}, 1000);`
      }
      
      // Time
      case 'arduino_delay': {
        const time = block.getFieldValue('TIME')
        return `delay(${time});`
      }
      
      case 'arduino_delay_microseconds': {
        const microTime = block.getFieldValue('TIME')
        return `delayMicroseconds(${microTime});`
      }
      
      case 'arduino_millis':
        return `millis()`
      
      case 'text_string': {
        const stringValue = block.getFieldValue('TEXT')
        return `"${stringValue}"`
      }
      
      default:
        return `// ${block.type}`
    }
  }

  return (
    <div 
      ref={blocklyDivRef} 
      className="w-full h-full rounded-lg"
      style={{ 
        minHeight: '400px',
        position: 'relative',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none'
      }}
    />
  )
}
