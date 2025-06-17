import { useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import Editor, { Monaco, OnMount } from '@monaco-editor/react'
import { loader } from '@monaco-editor/react'
import { useTheme } from '@renderer/lib/ThemeProvider'

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
  const { theme } = useTheme()

  const handleFileSelect = (file): void => {
    setViewingFile(file)
  }

  function handleBeforeMount(monaco): void {
    monaco.editor.defineTheme('tiny-dark-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [{ background: '1e1e1e' }],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.lineHighlightBackground': '#263c33',
        'editorCursor.foreground': '#359766',
        'editorLineNumber.foreground': '#6aaf8c',
        'editorLineNumber.activeForeground': '#359766',
        'editor.selectionBackground': '#35976644',
        'editor.selectionHighlightBackground': '#35976622',
        'editorBracketMatch.background': '#35976633',
        'editorBracketMatch.border': '#359766',
        'editorIndentGuide.background': '#2c2c2c',
        'editorIndentGuide.activeBackground': '#359766',
        'editorGutter.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4'
      }
    })
    monaco.editor.defineTheme('tiny-light-theme', {
      base: 'vs',
      inherit: true,
      rules: [{ background: '#ffffff' }],
      colors: {
        'editor.background': '#ffffff',
        'editor.lineHighlightBackground': '#e6f4ee',
        'editorCursor.foreground': '#359766',
        'editorLineNumber.foreground': '#a3cdb7',
        'editorLineNumber.activeForeground': '#359766',
        'editor.selectionBackground': '#35976633',
        'editor.selectionHighlightBackground': '#35976618',
        'editorBracketMatch.background': '#35976622',
        'editorBracketMatch.border': '#359766',
        'editorIndentGuide.background': '#f0f0f0',
        'editorIndentGuide.activeBackground': '#359766',
        'editorGutter.background': '#ffffff',
        'editor.foreground': '#222222'
      }
    })
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

  // TODO: Implement better logic for the tabs
  // TODO: Make this a controlled component so that we can manage via state
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
        defaultValue={sampleContent}
        // language="arduino"
        theme={theme === 'light' ? 'tiny-light-theme' : 'tiny-dark-theme'}
        // value={sampleContent}
        // onChange={handleContentChange}
        onMount={handleEditorMounted}
        beforeMount={handleBeforeMount}
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
