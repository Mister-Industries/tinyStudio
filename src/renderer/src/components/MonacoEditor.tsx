import { Editor, Monaco, OnMount } from '@monaco-editor/react'
import { useTheme } from '@renderer/lib/ThemeProvider'
import { EditorFile } from '@renderer/redux'
import { useRef } from 'react'

interface MonacoEditorProps {
  activeFile: EditorFile
  onContentChange: (content: string) => void
  onSaveFile: (content: string) => Promise<void>
}

export function MonacoEditor({
  activeFile,
  onContentChange,
  onSaveFile
}: MonacoEditorProps): React.JSX.Element {
  const editorRef = useRef<ReturnType<typeof import('monaco-editor').editor.create> | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const { theme } = useTheme()

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

    // Add save command (Ctrl+S)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const currentContent = editor.getValue() || ''
      onSaveFile(currentContent)
    })

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
  }

  const handleContentChange = (value: string | undefined): void => {
    if (value !== undefined) {
      onContentChange(value)
    }
  }

  return (
    <Editor
      height="100%"
      language="arduino"
      theme={theme === 'light' ? 'tiny-light-theme' : 'tiny-dark-theme'}
      value={activeFile.content || ''}
      onChange={handleContentChange}
      onMount={handleEditorMounted}
      beforeMount={handleBeforeMount}
      options={{
        fontFamily: '"Fira Code", "JetBrains Mono", monospace',
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'on',
        tabSize: 2,
        renderLineHighlight: 'line',
        lineNumbers: 'on',
        glyphMargin: true,
        folding: true,
        padding: { top: 16, bottom: 16 },
        lineDecorationsWidth: 10,
        lineNumbersMinChars: 3,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          useShadows: false
        },
        bracketPairColorization: {
          enabled: true
        },
        guides: {
          bracketPairs: 'active'
        }
      }}
    />
  )
}
