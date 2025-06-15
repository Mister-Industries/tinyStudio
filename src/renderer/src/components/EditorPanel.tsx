import { useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import Editor, { Monaco, OnMount } from '@monaco-editor/react'
import { loader } from '@monaco-editor/react'

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

const sampleContent = `const int ledPin = 13;  // the pin for the LED

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
}`

export function EditorPanel(): React.JSX.Element {
  const openFiles = ['file1.txt', 'file2.txt', 'file3.txt']
  const [viewingFile, setViewingFile] = useState<string>(openFiles[0])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<Monaco | null>(null)

  const handleFileSelect = (file): void => {
    setViewingFile(file)
  }

  const handleEditorMounted: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Set Arduino language configuration
    monaco.languages.register({ id: 'arduino' })

    // Define Arduino syntax highlighting with fixed tokenizer
    monaco.languages.setMonarchTokensProvider('arduino', {
      tokenizer: {
        root: [
          [
            /\b(void|int|float|double|bool|char|unsigned|long|short|String|byte|word|boolean)\b/,
            'keyword.type'
          ],
          [
            /\b(const|setup|loop|if|else|for|while|do|switch|case|default|break|continue|return|sizeof|true|false|null|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP)\b/,
            'keyword'
          ],
          [
            /\b(pinMode|digitalWrite|digitalRead|analogRead|analogWrite|delay|delayMicroseconds|millis|micros|map|random|randomSeed|min|max|constrain|abs|pow|sqrt|sin|cos|tan|Serial|Serial1|Serial2|Serial3|begin|print|println|available|read|write|flush|parseInt|parseFloat|readStringUntil|find|findUntil|peek|readBytes|readBytesUntil|setTimeout|setTimeoutUntil|readString|parseInt|parseFloat)\b/,
            'predefined'
          ],
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
          [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
          [/\d+/, 'number'],
          [/[{}()[\]]/, '@brackets'],
          [/[<>]/, '@brackets'],
          [/[;,.]/, 'delimiter'],
          [/[a-zA-Z_]\w*/, 'identifier']
        ],
        comment: [
          [/[^/*]+/, 'comment'],
          [/\/\*/, 'comment', '@push'],
          [/\*\//, 'comment', '@pop'],
          [/[/*]/, 'comment']
        ],
        string: [
          [/[^\\"]+/, 'string'],
          [/\\./, 'string.escape'],
          [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
        ]
      }
    })

    // // Register cursor position change
    // editor.onDidChangeCursorPosition((e) => {
    //   setCursorPosition({
    //     lineNumber: e.position.lineNumber,
    //     column: e.position.column
    //   })
    // })
  }

  const handleContentChange = (value: string | undefined): void => {
    // if (currentFile && value !== undefined) {
    //   updateFileContent(currentFile.id, value)
    // }
  }

  return (
    <div className="flex size-full flex-col">
      <div className="flex w-full border-b border-border">
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
      <Editor
        height="100%"
        defaultLanguage="arduino"
        defaultValue="// Start coding in Arduino!"
        // language="arduino"
        // theme="light"
        // value={sampleContent}
        // onChange={handleContentChange}
        onMount={handleEditorMounted}
        // options={{
        //   fontFamily: '"Fira Code", "JetBrains Mono", monospace',
        //   fontSize: 14,
        //   minimap: { enabled: false },
        //   scrollBeyondLastLine: false,
        //   automaticLayout: true,
        //   wordWrap: 'on',
        //   tabSize: 2,
        //   renderLineHighlight: 'line',
        //   lineNumbers: 'on',
        //   glyphMargin: true,
        //   folding: true,
        //   padding: { top: 16, bottom: 16 },
        //   lineDecorationsWidth: 10,
        //   lineNumbersMinChars: 3,
        //   scrollbar: {
        //     verticalScrollbarSize: 8,
        //     horizontalScrollbarSize: 8,
        //     useShadows: false
        //   },
        //   bracketPairColorization: {
        //     enabled: true
        //   },
        //   guides: {
        //     bracketPairs: 'active'
        //   }
        // }}
      />
    </div>
  )
}
