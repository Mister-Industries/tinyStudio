import { OpenFileCommand, OpenWorkspaceCommand, RefreshWorkspaceCommand } from '@renderer/commands/fileCommands'
import { loader } from '@monaco-editor/react'
import tinyLogo from '@renderer/assets/tinyLogo.png'
import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { fileSystem } from '@renderer/lib/fileSystem'
import { pushSerialLine } from '@renderer/lib/serialBus'
import { buildVisualExportHtml } from '@renderer/lib/visualExport'
import { selectOpenFiles, useAppDispatch, useAppSelector } from '@renderer/redux'
import { selectEditorView, setEditorView } from '@renderer/redux/editorSlice'
import {
  BaseFileItem,
  closeFile,
  EditorFile,
  saveFileWithContent,
  selectViewingFileId,
  setViewingFile,
  updateFileContent,
  updateReadmeContent
} from '@renderer/redux/fileSlice'
import { CircuitBoard, Code2, Download, FolderOpen, Loader2 } from 'lucide-react'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { BlocklyEditor } from './BlocklyEditor'
import { DiagramEditor } from './DiagramEditor'
import { MonacoEditor, MonacoEditorRef } from './MonacoEditor'
import { FileTabContent, FileTabs, FileTabsList, FileTabTrigger } from './ui/FileTab'
import { Button } from './ui/Button'
import { VisualPreview } from './VisualPreview'

loader.config({ monaco })

const DEFAULT_DIAGRAM = JSON.stringify(
  { version: 1, editor: 'tinystudio', parts: [], connections: [] },
  null,
  2
)
const DEFAULT_VISUAL = `// visual.js — Serial Plotter
// Graphs the latest number printed over Serial (serialValue()) as a scrolling
// line, auto-scaling to the data. Try Serial.println(analogRead(A0)) on the
// board. Switch to Code to edit this sketch; Visual to run it.

let data = [];
const MAX = 240; // points kept on screen

function setup() {
  createCanvas(480, 280);
  textFont('monospace');
}

function draw() {
  background(7, 11, 34);

  // pull the most recent serial value each frame
  data.push(serialValue());
  if (data.length > MAX) data.shift();

  // auto-scale to the data range (with a little headroom)
  let lo = Math.min(...data, 0);
  let hi = Math.max(...data, 1);
  if (hi === lo) hi = lo + 1;

  // grid
  stroke(26, 31, 77);
  strokeWeight(1);
  for (let i = 0; i <= 4; i++) {
    let y = map(i, 0, 4, 20, height - 24);
    line(40, y, width - 12, y);
  }

  // plotted line
  noFill();
  stroke(0, 240, 255);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < data.length; i++) {
    let x = map(i, 0, MAX - 1, 40, width - 12);
    let y = map(data[i], lo, hi, height - 24, 20);
    vertex(x, y);
  }
  endShape();

  // readouts
  noStroke();
  fill(235, 238, 255);
  textSize(12);
  text('value: ' + serialValue().toFixed(2), 44, 16);
  fill(120, 130, 170);
  text(hi.toFixed(0), 8, 24);
  text(lo.toFixed(0), 8, height - 24);
}
`

function findInTree(items: BaseFileItem[], match: (i: BaseFileItem) => boolean): BaseFileItem | null {
  for (const item of items) {
    if (item.type === 'file' && item.name && match(item)) return item
    if (item.children) {
      const found = findInTree(item.children, match)
      if (found) return found
    }
  }
  return null
}

/**
 * Ensure a project file (e.g. diagram.json / visual.js) is open as an editor
 * buffer, creating it from a default if it doesn't exist yet. Returns the open
 * file once ready. Used by the full-window Circuit/Visual views so their edits
 * live in the same buffer model as code (saved on Ctrl+S / build).
 */
function useProjectFile(name: string, makeDefault?: () => string): EditorFile | undefined {
  const workspace = useAppSelector((s) => s.file.workspace)
  const openFiles = useAppSelector(selectOpenFiles)
  const file = openFiles.find((f) => f.name === name)
  const busy = useRef(false)

  useEffect(() => {
    if (file || !workspace || busy.current) return
    busy.current = true
    ;(async () => {
      try {
        let item = findInTree(workspace.root, (i) => i.name === name)
        if (!item && makeDefault) {
          const path = `${workspace.path}/${name}`
          await fileSystem.writeFile(path, makeDefault())
          await new RefreshWorkspaceCommand(workspace).execute()
          item = { id: crypto.randomUUID(), parentId: 'root', name, path, type: 'file' }
        }
        if (item) await new OpenFileCommand(item).execute()
      } finally {
        busy.current = false
      }
    })()
  }, [file, workspace, name, makeDefault])

  return file
}

export function EditorPanel({ size }: { size: number }): React.JSX.Element {
  const editorView = useAppSelector(selectEditorView)
  const pixelSize = Math.round((size / 100) * (window.innerHeight - 92))

  return (
    <div className="flex flex-col bg-navy-900" style={{ height: `${pixelSize}px` }}>
      {editorView === 'circuit' ? (
        <CircuitView />
      ) : editorView === 'visual' ? (
        <VisualView />
      ) : (
        <CodeView />
      )}
    </div>
  )
}

// ── Code view: the normal tabbed IDE ────────────────────────────────────────

function CodeView(): React.JSX.Element {
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector(selectViewingFileId)
  const editorMode = useAppSelector((state) => state.editor.editorMode)
  const workspace = useAppSelector((s) => s.file.workspace)
  const dispatch = useAppDispatch()
  const monacoEditorRef = useRef<MonacoEditorRef>(null)

  const handleFileClose = useCallback(
    (fileId: string): void => {
      dispatch(closeFile(fileId))
    },
    [dispatch]
  )

  const handleFileSelect = useCallback(
    (fileId: string): void => {
      dispatch(setViewingFile(fileId))
      setTimeout(() => {
        if (monacoEditorRef.current && editorMode !== 'blocks') monacoEditorRef.current.focus()
      }, 50)
    },
    [dispatch, editorMode]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
        event.preventDefault()
        if (viewingFileId) handleFileClose(viewingFileId)
      }
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        if (openFiles.length > 1) {
          const i = openFiles.findIndex((f) => f.id === viewingFileId)
          const next = event.shiftKey ? (i <= 0 ? openFiles.length - 1 : i - 1) : (i + 1) % openFiles.length
          if (openFiles[next]) handleFileSelect(openFiles[next].id)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewingFileId, handleFileClose, openFiles, handleFileSelect])

  const handleContentChange = useCallback(
    (content: string, fileId: string) => {
      const file = openFiles.find((f) => f.id === fileId)
      if (file) {
        dispatch(updateFileContent({ id: file.id, content }))
        if (file.name === 'README.md') dispatch(updateReadmeContent(content))
      }
    },
    [openFiles, dispatch]
  )

  const handleSaveFile = async (content: string, fileId: string): Promise<void> => {
    const file = openFiles.find((f) => f.id === fileId)
    if (file && file.path) {
      try {
        await fileSystem.writeFile(file.path, content)
        dispatch(saveFileWithContent({ id: file.id, content }))
      } catch (error) {
        console.error('Failed to save file:', error)
      }
    }
  }

  if (openFiles.length === 0) {
    return (
      <div className="size-full flex flex-col items-center justify-center text-sm gap-5">
        <div
          className="size-40"
          style={{
            backgroundColor: 'var(--navy-500)',
            mask: `url(${tinyLogo}) no-repeat center/contain`,
            WebkitMask: `url(${tinyLogo}) no-repeat center/contain`
          }}
        />
        <div className="text-center">
          <div className="text-fg-1 text-base font-semibold">No project open</div>
          <div className="text-fg-3 text-xs mt-1">Open a folder to start building.</div>
        </div>
        <Button
          size="lg"
          className="rounded-full px-6 shadow-[0_0_18px_rgba(0,240,255,0.25)]"
          onClick={() => new OpenWorkspaceCommand(workspace?.path).execute()}
        >
          <FolderOpen size={16} /> Open Folder
        </Button>
      </div>
    )
  }

  return (
    <FileTabs value={viewingFileId || undefined} onValueChange={handleFileSelect} className="h-full">
      <FileTabsList>
        <div className="flex">
          {openFiles.map((file) => (
            <FileTabTrigger key={file.id} value={file.id} file={file} onFileClose={handleFileClose} />
          ))}
        </div>
      </FileTabsList>
      {openFiles.map((file) => (
        <FileTabContent key={`content-${file.id}`} value={file.id}>
          {editorMode === 'blocks' ? (
            <BlocklyEditor />
          ) : (
            <MonacoEditor
              ref={monacoEditorRef}
              activeFile={file}
              onContentChange={(content) => handleContentChange(content, file.id)}
              onSaveFile={(content) => handleSaveFile(content, file.id)}
            />
          )}
        </FileTabContent>
      ))}
    </FileTabs>
  )
}

// ── Circuit view: full-window interactive diagram.json ──────────────────────

function CircuitView(): React.JSX.Element {
  const workspace = useAppSelector((s) => s.file.workspace)
  const dispatch = useAppDispatch()
  const file = useProjectFile('diagram.json', () => DEFAULT_DIAGRAM)

  if (!workspace) return <EmptyHint icon="circuit" label="Open a project to design its circuit." />
  if (!file) return <LoadingHint label="Loading circuit…" />

  return (
    <DiagramEditor
      content={file.content}
      onChange={(content) => dispatch(updateFileContent({ id: file.id, content }))}
    />
  )
}

// ── Visual view: full-window p5 sketch with an Edit-code button ─────────────

function VisualView(): React.JSX.Element {
  const workspace = useAppSelector((s) => s.file.workspace)
  const dispatch = useAppDispatch()
  const file = useProjectFile('visual.js', () => DEFAULT_VISUAL)

  // The Serial Monitor panel is closed in Visual view, so this view owns the
  // serial connection while it's open — feeding the running p5 sketch live data
  // via the shared serial bus. Suspended during uploads (port is exclusive).
  const { selectedBoard, isAgentConnected, isUploading, openSerial, closeSerial, onSerialData } =
    useArduinoContext()
  const port = selectedBoard?.port
  useEffect(() => {
    if (!isAgentConnected || !port || isUploading) return
    const off = onSerialData((line) => pushSerialLine(line))
    openSerial(port, 9600)
    const id = setInterval(() => openSerial(port, 9600), 4000) // resume if it drops
    return () => {
      clearInterval(id)
      off()
      closeSerial()
    }
  }, [isAgentConnected, port, isUploading, openSerial, closeSerial, onSerialData])

  if (!workspace) return <EmptyHint icon="circuit" label="Open a project to run its visual." />
  if (!file) return <LoadingHint label="Loading visual…" />

  const exportWeb = async (): Promise<void> => {
    // Title the page after the .ino project (not the workspace folder), and
    // default to index.html in the project root — best practice for hosting.
    const ino = workspace ? findInTree(workspace.root, (i) => /\.ino$/i.test(i.name!)) : null
    const projectName = ino?.name?.replace(/\.ino$/i, '') || workspace?.name || 'tinyStudio sketch'
    const html = buildVisualExportHtml(projectName, file.content)
    const defaultPath = workspace ? `${workspace.path}/index.html` : 'index.html'
    try {
      const saved = await window.api.fs.saveFileAs(defaultPath, html)
      if (saved) toast.success('Exported web page', { description: saved })
    } catch (e) {
      toast.error('Export failed', { description: e instanceof Error ? e.message : 'Unknown error' })
    }
  }

  return (
    <div className="size-full relative">
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <Button
          size="icon"
          variant="outline"
          className="rounded-full"
          title="Edit code"
          onClick={() => {
            dispatch(setViewingFile(file.id))
            dispatch(setEditorView('code'))
          }}
        >
          <Code2 size={16} />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="rounded-full"
          title="Export for web"
          onClick={exportWeb}
        >
          <Download size={16} />
        </Button>
      </div>
      <VisualPreview code={file.content} name={file.name} />
    </div>
  )
}

function EmptyHint({ label }: { icon: string; label: string }): React.JSX.Element {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-3 text-center text-fg-3">
      <CircuitBoard size={40} className="opacity-40" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function LoadingHint({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-3 text-fg-3">
      <Loader2 size={22} className="animate-spin text-cyan" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
