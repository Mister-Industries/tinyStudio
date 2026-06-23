import { Editor, Monaco, OnMount } from '@monaco-editor/react'
import { useTheme } from '@renderer/lib/ThemeProvider'
import { EditorFile } from '@renderer/redux'
import { forwardRef, useImperativeHandle, useRef } from 'react'

interface MonacoEditorProps {
  activeFile: EditorFile
  onContentChange: (content: string) => void
  onSaveFile: (content: string) => Promise<void>
}

export interface MonacoEditorRef {
  focus: () => void
}

export const MonacoEditor = forwardRef<MonacoEditorRef, MonacoEditorProps>(
  ({ activeFile, onContentChange, onSaveFile }, ref) => {
    const editorRef = useRef<ReturnType<typeof import('monaco-editor').editor.create> | null>(null)
    const monacoRef = useRef<Monaco | null>(null)
    const { theme } = useTheme()

    useImperativeHandle(ref, () => ({
      focus: () => {
        if (editorRef.current) {
          editorRef.current.focus()
        }
      }
    }))

    function handleBeforeMount(monaco): void {
      // tinyStudio "Studio Dark" — colors from the tinyForge token set.
      // Both theme names resolve to the same navy theme: the design system is
      // dark-first, so light mode stays on brand.
      const studioDark = {
        base: 'vs-dark' as const,
        inherit: true,
        rules: [
          { token: '', foreground: 'd7deff', background: '070b22' },
          { token: 'keyword', foreground: 'ff3f8c' },
          { token: 'keyword.type', foreground: '00f0ff' },
          { token: 'predefined', foreground: '5cc8ff' },
          { token: 'string', foreground: '3ddc97' },
          { token: 'string.quote', foreground: '3ddc97' },
          { token: 'string.escape', foreground: '3ddc97' },
          { token: 'number', foreground: 'f7a400' },
          { token: 'number.float', foreground: 'f7a400' },
          { token: 'comment', foreground: '5f6aa0' },
          { token: 'identifier', foreground: 'd7deff' },
          { token: 'delimiter', foreground: '8b94c8' }
        ],
        colors: {
          'editor.background': '#070b22',
          'editor.foreground': '#d7deff',
          'editor.lineHighlightBackground': '#11173a',
          'editorCursor.foreground': '#00f0ff',
          'editorLineNumber.foreground': '#4a5296',
          'editorLineNumber.activeForeground': '#00f0ff',
          'editor.selectionBackground': '#00f0ff33',
          'editor.selectionHighlightBackground': '#00f0ff1a',
          'editorBracketMatch.background': '#00f0ff22',
          'editorBracketMatch.border': '#00f0ff',
          'editorIndentGuide.background': '#1a1f4d',
          'editorIndentGuide.activeBackground': '#353c78',
          'editorGutter.background': '#070b22',
          'editorWidget.background': '#1a1f4d',
          'editorWidget.border': '#353c78',
          'editorSuggestWidget.background': '#1a1f4d',
          'editorSuggestWidget.selectedBackground': '#262c5e',
          'scrollbarSlider.background': '#353c7866',
          'scrollbarSlider.hoverBackground': '#353c78aa'
        }
      }
      monaco.editor.defineTheme('tiny-dark-theme', studioDark)
      monaco.editor.defineTheme('tiny-light-theme', studioDark)
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
        // A stable per-file model (keyed by path) + keepCurrentModel preserves
        // each file's undo history (Ctrl+Z) across tab switches and view
        // changes, instead of resetting it on every remount.
        path={activeFile.path || activeFile.id}
        keepCurrentModel
        value={activeFile.content || ''}
        onChange={handleContentChange}
        onMount={handleEditorMounted}
        beforeMount={handleBeforeMount}
        options={{
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
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
)

MonacoEditor.displayName = 'MonacoEditor'
