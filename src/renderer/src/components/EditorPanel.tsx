import { useState } from 'react'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import { Blocks, Code } from 'lucide-react'
import { BlocklyEditor } from './BlocklyEditor'
import { MonacoEditor } from './MonacoEditor'

loader.config({ monaco })

export interface ArduinoFile {
  id: string
  name: string
  content: string
  fileHandle?: FileSystemFileHandle
  modified: boolean
  createdAt: string
  updatedAt: string
}

export function EditorPanel(): React.JSX.Element {
  const openFiles = ['file1.txt', 'file2.txt', 'file3.txt']
  const [viewingFile, setViewingFile] = useState<string>(openFiles[0])

  const [isBlocks, setIsBlocks] = useState<boolean>(false)
  
  // State for managing file content - both Arduino code and Blockly XML
  const [fileContent, setFileContent] = useState<string>(`const int ledPin = 13;  // the pin for the LED

void setup() {
  pinMode(ledPin, OUTPUT);  // initialize the LED pin as an output
  Serial.begin(9600);     // initialize serial communication at 9600 bits per second
  Serial.println("Blink example initialized");
}

void loop() {
  digitalWrite(ledPin, HIGH);  // turn the LED on (HIGH is the voltage level)
  Serial.println("LED ON");
  delay(1000);                 // wait for a second
  digitalWrite(ledPin, LOW);   // turn the LED off by making the voltage LOW
  Serial.println("LED OFF");
  delay(1000);                 // wait for a second
}`)

  // Separate state for Blockly XML - this is key for persistence
  const [blocklyXml, setBlocklyXml] = useState<string>('')

  const handleFileSelect = (file): void => {
    setViewingFile(file)
  }

  // Callback function for when content changes in Monaco editor
  const handleMonacoContentChange = (newContent: string): void => {
    setFileContent(newContent)
    // When Monaco content changes, we need to update Blockly XML
    // This will be handled by the BlocklyEditor when it receives the new content
  }

  // Callback function for when content changes in Blockly editor
  const handleBlocklyContentChange = (newCode: string, newXml: string): void => {
    setFileContent(newCode)
    setBlocklyXml(newXml)
  }

  // TODO: Implement better logic for the tabs
  // TODO: Make this a controlled component so that we can manage via state
  return (
    <div className="flex size-full flex-col">
      <div className="flex w-full border-b border-border justify-between">
        <div className="flex w-full">
          {openFiles.map((file) => (
            <div
              data-active={viewingFile === file}
              key={file}
              className="text-xs justify-start px-4 py-2 border-b border-transparent data-[active=true]:bg-muted data-[active=true]:border-b data-[active=true]:border-primary hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => handleFileSelect(file)}
            >
              {file}
            </div>
          ))}
        </div>
        <div className="flex">
          <button
            data-active={isBlocks == false}
            onClick={() => setIsBlocks(false)}
            className="flex items-center gap-2 p-2 hover:bg-accent/50 hover:text-accent-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:border-b data-[active=true]:border-primary"
          >
            <Code />
            Code
          </button>
          <button
            data-active={isBlocks == true}
            onClick={() => setIsBlocks(true)}
            className="flex items-center gap-2 p-2 hover:bg-accent/50 hover:text-accent-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:border-b data-[active=true]:border-primary"
          >
            <Blocks />
            Blocks
          </button>
        </div>
      </div>
      {isBlocks ? (
        <BlocklyEditor 
          content={fileContent}
          initialBlocks={blocklyXml}
          onContentChange={handleBlocklyContentChange} 
        />
      ) : (
        <MonacoEditor 
          content={fileContent} 
          onContentChange={handleMonacoContentChange} 
        />
      )}
    </div>
  )
}
