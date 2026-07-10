import { Editor, Monaco, OnMount } from '@monaco-editor/react'
import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { diagnosticMatchesFile } from '@renderer/lib/compileErrors'
import { attachLspToEditor } from '@renderer/lib/lsp/monacoLsp'
import { useTheme } from '@renderer/lib/ThemeProvider'
import { EditorFile } from '@renderer/redux'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

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
    const { lastCompileResult, selectedBoard, isAgentConnected } = useArduinoContext()
    // Bumped when the editor mounts so effects that need editor/monaco refs
    // re-run (refs alone don't trigger renders).
    const [editorReady, setEditorReady] = useState(false)

    useImperativeHandle(ref, () => ({
      focus: () => {
        if (editorRef.current) {
          editorRef.current.focus()
        }
      }
    }))

    // ── Inline compile diagnostics ────────────────────────────────────────
    // Render the last build's errors/warnings as squiggles in the gutter of
    // the file they belong to (Arduino IDE parity), instead of leaving them
    // only as text in the Output pane. Cleared on a successful build.
    useEffect(() => {
      const monaco = monacoRef.current
      const editor = editorRef.current
      const model = editor?.getModel()
      if (!monaco || !model) return

      const filePath = activeFile.path || activeFile.id
      const all = [
        ...(lastCompileResult?.errors ?? []).map((e) => ({ ...e, isError: true })),
        ...(lastCompileResult?.warnings ?? []).map((w) => ({ ...w, isError: false }))
      ]
      const markers = all
        .filter(
          (d) =>
            d.file &&
            d.line &&
            diagnosticMatchesFile(
              { file: d.file, line: d.line ?? 1, column: d.column ?? 1, severity: 'error', message: d.message },
              filePath
            )
        )
        .map((d) => ({
          severity: d.isError ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.line ?? 1,
          startColumn: d.column ?? 1,
          endLineNumber: d.line ?? 1,
          endColumn: model.getLineMaxColumn(Math.min(d.line ?? 1, model.getLineCount()))
        }))
      monaco.editor.setModelMarkers(model, 'arduino-compile', markers)
    }, [lastCompileResult, activeFile.path, activeFile.id, editorReady])

    // ── Language server (code intelligence) ───────────────────────────────
    // Bridges Monaco to the Arduino Language Server (clangd) via tinyService's
    // /lsp WebSocket. Desktop-only for now: the LS needs the sketch on disk,
    // which mem:// (browser) sketches don't have. Degrades silently when the
    // backend has no language-server binaries.
    useEffect(() => {
      const monaco = monacoRef.current
      const editor = editorRef.current
      const fqbn = selectedBoard?.config.fqbn
      const filePath = activeFile.path
      if (!monaco || !editor || !fqbn || !isAgentConnected) return
      if (!filePath || filePath.startsWith('mem://')) return
      const detach = attachLspToEditor(monaco, editor, filePath, fqbn)
      return detach
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBoard?.config.fqbn, isAgentConnected, activeFile.path, editorReady])

    function handleBeforeMount(monaco): void {
      // Design-system surfaces (cold charcoal dark / near-white light) with the
      // existing tinyForge syntax hues kept on dark; light uses deeper variants
      // of the same hues for contrast on a pale background.
      monaco.editor.defineTheme('tiny-dark-theme', {
        base: 'vs-dark' as const,
        inherit: true,
        rules: [
          { token: '', foreground: 'dbdee1', background: '1e1f22' },
          { token: 'keyword', foreground: 'ff3f8c' },
          { token: 'keyword.type', foreground: '00f0ff' },
          { token: 'predefined', foreground: '5cc8ff' },
          { token: 'string', foreground: '3ddc97' },
          { token: 'string.quote', foreground: '3ddc97' },
          { token: 'string.escape', foreground: '3ddc97' },
          { token: 'number', foreground: 'f7a400' },
          { token: 'number.float', foreground: 'f7a400' },
          { token: 'comment', foreground: '6b7077' },
          { token: 'identifier', foreground: 'dbdee1' },
          { token: 'delimiter', foreground: '969ba3' }
        ],
        colors: {
          'editor.background': '#1e1f22',
          'editor.foreground': '#dbdee1',
          'editor.lineHighlightBackground': '#ffffff0d',
          'editorCursor.foreground': '#42a5f5',
          'editorLineNumber.foreground': '#6b7077',
          'editorLineNumber.activeForeground': '#dbdee1',
          'editor.selectionBackground': '#42a5f540',
          'editor.selectionHighlightBackground': '#42a5f51a',
          'editorBracketMatch.background': '#42a5f522',
          'editorBracketMatch.border': '#42a5f5',
          'editorIndentGuide.background': '#2b2d31',
          'editorIndentGuide.activeBackground': '#3c3f45',
          'editorGutter.background': '#1e1f22',
          'editorWidget.background': '#383a40',
          'editorWidget.border': '#3c3f45',
          'editorSuggestWidget.background': '#383a40',
          'editorSuggestWidget.selectedBackground': '#2b2d31',
          'scrollbarSlider.background': '#4a4d5466',
          'scrollbarSlider.hoverBackground': '#4a4d54aa'
        }
      })
      monaco.editor.defineTheme('tiny-light-theme', {
        base: 'vs' as const,
        inherit: true,
        rules: [
          { token: '', foreground: '24272c', background: 'fafbfc' },
          { token: 'keyword', foreground: 'd81f6a' },
          { token: 'keyword.type', foreground: '0e8fa8' },
          { token: 'predefined', foreground: '1e88e5' },
          { token: 'string', foreground: '1e7a4d' },
          { token: 'string.quote', foreground: '1e7a4d' },
          { token: 'string.escape', foreground: '1e7a4d' },
          { token: 'number', foreground: 'b5760a' },
          { token: 'number.float', foreground: 'b5760a' },
          { token: 'comment', foreground: '79818c' },
          { token: 'identifier', foreground: '24272c' },
          { token: 'delimiter', foreground: '79818c' }
        ],
        colors: {
          'editor.background': '#fafbfc',
          'editor.foreground': '#24272c',
          'editor.lineHighlightBackground': '#1814170a',
          'editorCursor.foreground': '#1e88e5',
          'editorLineNumber.foreground': '#a3abb5',
          'editorLineNumber.activeForeground': '#24272c',
          'editor.selectionBackground': '#42a5f533',
          'editor.selectionHighlightBackground': '#42a5f51a',
          'editorBracketMatch.background': '#42a5f522',
          'editorBracketMatch.border': '#1e88e5',
          'editorIndentGuide.background': '#e3e7ec',
          'editorIndentGuide.activeBackground': '#cfd5dc',
          'editorGutter.background': '#fafbfc',
          'editorWidget.background': '#ffffff',
          'editorWidget.border': '#cfd5dc',
          'editorSuggestWidget.background': '#ffffff',
          'editorSuggestWidget.selectedBackground': '#edf0f3',
          'scrollbarSlider.background': '#a3abb566',
          'scrollbarSlider.hoverBackground': '#a3abb5aa'
        }
      })
    }

    const handleEditorMounted: OnMount = (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco
      setEditorReady(true)

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
          fontFamily: '"Fira Code", "JetBrains Mono", ui-monospace, monospace',
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
