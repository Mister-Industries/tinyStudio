import { useEffect, useRef, useState } from 'react'
import * as Blockly from 'blockly'
import { useTheme } from '@renderer/lib/ThemeProvider'
import {
  defineArduinoBlocks,
  defineArduinoGenerators
  // ArduinoGenerator
} from '@renderer/lib/arduinoBlocks'

export function BlocklyEditor(): React.JSX.Element {
  const blocklyDivRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const { theme } = useTheme()
  const [workspaceContent, setWorkspaceContent] = useState<string>('')

  // Handle workspace updates - this is the single point your co-worker can use
  const handleWorkspaceUpdate = (): void => {
    if (workspaceRef.current) {
      const xml = Blockly.Xml.workspaceToDom(workspaceRef.current)
      const xmlText = Blockly.Xml.domToText(xml)
      setWorkspaceContent(xmlText)

      // Generate Arduino code from blocks
      // const code = ArduinoGenerator.workspaceToCode(workspaceRef.current)
    }
  }

  useEffect(() => {
    if (!blocklyDivRef.current) return

    // Define our Arduino blocks and generators
    defineArduinoBlocks()
    defineArduinoGenerators()

    // Configure Blockly theme based on app theme
    const blocklyTheme = theme === 'dark' ? Blockly.Themes.Classic : Blockly.Themes.Classic

    // Create the workspace
    const workspace = Blockly.inject(blocklyDivRef.current, {
      theme: blocklyTheme,
      media: '/media/',
      toolbox: {
        kind: 'categoryToolbox',
        contents: [
          {
            kind: 'category',
            name: 'Logic',
            colour: '210',
            contents: [
              { kind: 'block', type: 'controls_if' },
              { kind: 'block', type: 'logic_compare' },
              { kind: 'block', type: 'logic_operation' },
              { kind: 'block', type: 'logic_negate' },
              { kind: 'block', type: 'logic_boolean' }
            ]
          },
          {
            kind: 'category',
            name: 'Loops',
            colour: '120',
            contents: [
              { kind: 'block', type: 'controls_repeat_ext' },
              { kind: 'block', type: 'controls_whileUntil' },
              { kind: 'block', type: 'controls_for' },
              { kind: 'block', type: 'controls_forEach' }
            ]
          },
          {
            kind: 'category',
            name: 'Math',
            colour: '230',
            contents: [
              { kind: 'block', type: 'math_number' },
              { kind: 'block', type: 'math_arithmetic' },
              { kind: 'block', type: 'math_single' },
              { kind: 'block', type: 'math_random_int' },
              { kind: 'block', type: 'math_constrain' }
            ]
          },
          {
            kind: 'category',
            name: 'Arduino',
            colour: '60',
            contents: [
              { kind: 'block', type: 'arduino_setup' },
              { kind: 'block', type: 'arduino_loop' },
              { kind: 'separator' },
              { kind: 'block', type: 'arduino_pin_mode' },
              { kind: 'block', type: 'arduino_digital_write' },
              { kind: 'block', type: 'arduino_digital_read' },
              { kind: 'block', type: 'arduino_analog_read' },
              { kind: 'block', type: 'arduino_analog_write' },
              { kind: 'separator' },
              { kind: 'block', type: 'arduino_delay' },
              { kind: 'block', type: 'arduino_millis' },
              { kind: 'separator' },
              { kind: 'block', type: 'arduino_serial_begin' },
              { kind: 'block', type: 'arduino_serial_print' },
              { kind: 'block', type: 'arduino_serial_println' },
              { kind: 'separator' },
              { kind: 'block', type: 'arduino_map' },
              { kind: 'block', type: 'arduino_constrain' },
              { kind: 'block', type: 'arduino_random' },
              { kind: 'separator' },
              { kind: 'block', type: 'arduino_servo_write' },
              { kind: 'block', type: 'arduino_lcd_print' },
              { kind: 'block', type: 'arduino_ultrasonic_read' },
              { kind: 'block', type: 'arduino_motor_control' }
            ]
          },
          {
            kind: 'category',
            name: 'Variables',
            colour: '330',
            custom: 'VARIABLE'
          },
          {
            kind: 'category',
            name: 'Functions',
            colour: '290',
            custom: 'PROCEDURE'
          }
        ]
      },
      grid: {
        spacing: 20,
        length: 3,
        colour: theme === 'dark' ? '#444' : '#ccc',
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
      scrollbars: true,
      move: {
        scrollbars: true,
        drag: true,
        wheel: true
      }
    })

    workspaceRef.current = workspace

    // Add event listeners for workspace changes
    workspace.addChangeListener(handleWorkspaceUpdate)

    // Add some sample blocks to get started
    const sampleBlocks = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="arduino_setup" x="50" y="50">
          <next>
            <block type="arduino_pin_mode">
              <field name="PIN">13</field>
              <field name="MODE">OUTPUT</field>
              <next>
                <block type="arduino_serial_begin">
                  <field name="BAUD">9600</field>
                  <next>
                    <block type="arduino_serial_println">
                      <field name="TEXT">Arduino initialized!</field>
                    </block>
                  </next>
                </block>
              </next>
            </block>
          </next>
        </block>
        <block type="arduino_loop" x="50" y="200">
          <next>
            <block type="arduino_digital_write">
              <field name="PIN">13</field>
              <field name="STATE">HIGH</field>
              <next>
                <block type="arduino_serial_println">
                  <field name="TEXT">LED ON</field>
                  <next>
                    <block type="arduino_delay">
                      <field name="DELAY">1000</field>
                      <next>
                        <block type="arduino_digital_write">
                          <field name="PIN">13</field>
                          <field name="STATE">LOW</field>
                          <next>
                            <block type="arduino_serial_println">
                              <field name="TEXT">LED OFF</field>
                              <next>
                                <block type="arduino_delay">
                                  <field name="DELAY">1000</field>
                                </block>
                              </next>
                            </block>
                          </next>
                        </block>
                      </next>
                    </block>
                  </next>
                </block>
              </next>
            </block>
          </next>
        </block>
      </xml>
    `

    try {
      const parser = new DOMParser()
      const xml = parser.parseFromString(sampleBlocks, 'text/xml')
      Blockly.Xml.domToWorkspace(xml.documentElement, workspace)
    } catch (error) {
      console.warn('Could not load sample blocks:', error)
    }

    // Cleanup function
    return () => {
      if (workspace) {
        workspace.dispose()
      }
    }
  }, [theme])

  return (
    <div className="h-full w-full flex flex-col" data-theme={theme}>
      <div className="flex-1 relative">
        <div
          ref={blocklyDivRef}
          className="absolute inset-0"
          style={{
            backgroundColor: theme === 'dark' ? '#1e1e1e' : '#ffffff'
          }}
        />
      </div>
      {/* Optional: Add a status bar or controls here */}
      <div className="h-8 bg-muted border-t border-border flex items-center px-3 text-xs text-muted-foreground">
        <span>Blocks: {workspaceContent ? 'Modified' : 'Empty'}</span>
      </div>
    </div>
  )
}
