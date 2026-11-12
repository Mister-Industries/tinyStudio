// Circuit view: the full-window circuit.json editor (docs/circuit-view-tech-spec.md).

import { fileSystem } from '@renderer/lib/fileSystem'
import { notify as toast } from '@renderer/lib/notify'
import { useAppDispatch, useAppSelector } from '@renderer/redux'
import { selectPanelState, setEditorView, setPanelOpen } from '@renderer/redux/editorSlice'
import { revealFile, updateFileContent, type Workspace } from '@renderer/redux/fileSlice'
import { CircuitBoard, FileClock, History } from 'lucide-react'
import React from 'react'
import { Button } from '../ui/Button'
import { clearDraft, recoverableDraft, saveDraft, type Draft } from '@renderer/lib/unsavedDrafts'
import { emptyDoc, parseCircuitFile, serializeDoc } from '../../circuit'
import { CircuitViewV2 } from '../../circuit/views/CircuitView'
import { LoadingHint } from './LoadingHint'
import { MissingFileView } from './MissingFileView'
import { createProjectFile, findInTree, saveKiCadProject, useProjectFile } from './projectFiles'

/**
 * The native file is `circuit.json` (spec §4, §13). A project without one gets
 * an offer to create it, and a project that only has a v1 `diagram.json` gets
 * an offer to convert it. Neither happens until the user clicks: opening the
 * view must not change the project folder.
 */
export function CircuitPane(): React.JSX.Element | null {
  const workspace = useAppSelector((s) => s.file.workspace)

  // EditorPanel shows the start screen until a project is open.
  if (!workspace) return null
  if (findInTree(workspace.root, (i) => i.name === 'circuit.json')) return <CircuitFileEditor />

  const diagram = findInTree(workspace.root, (i) => i.name === 'diagram.json')
  if (diagram?.path) return <ConvertDiagramView workspace={workspace} diagramPath={diagram.path} />

  return (
    <MissingFileView
      icon={<CircuitBoard size={36} />}
      title="This project has no circuit yet"
      description={
        <p>
          Creating one adds an empty <code>circuit.json</code> to the project folder.
        </p>
      }
      action="Create circuit"
      onAction={async () => {
        try {
          await createProjectFile(workspace, 'circuit.json', serializeDoc(emptyDoc()))
        } catch (e) {
          toast.error('Could not create circuit.json', {
            description: e instanceof Error ? e.message : 'Unknown error'
          })
        }
      }}
    />
  )
}

/** Old projects have a v1 `diagram.json`. Converting writes `circuit.json` and keeps the original. */
function ConvertDiagramView({
  workspace,
  diagramPath
}: {
  workspace: Workspace
  diagramPath: string
}): React.JSX.Element {
  const convert = async (): Promise<void> => {
    try {
      const old = await fileSystem.readFile(diagramPath)
      const { doc } = parseCircuitFile(old)
      await fileSystem.writeFile(`${workspace.path}/diagram.json.bak`, old)
      await createProjectFile(workspace, 'circuit.json', serializeDoc(doc))
    } catch (e) {
      toast.error('Could not convert diagram.json', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    }
  }
  return (
    <MissingFileView
      icon={<FileClock size={36} />}
      title="This circuit is in the old format"
      description={
        <p>
          The project has a <code>diagram.json</code> from an earlier tinyStudio. Converting writes{' '}
          <code>circuit.json</code> and keeps the original as <code>diagram.json.bak</code>.
        </p>
      }
      action="Convert"
      onAction={convert}
    />
  )
}

function CircuitFileEditor(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const workspace = useAppSelector((s) => s.file.workspace)
  const file = useProjectFile('circuit.json')
  const path = file?.path
  const content = file?.content

  // crash recovery: offer the unsaved copy once, when the file first loads
  const [offer, setOffer] = React.useState<Draft | null>(null)
  const checked = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!path || content === undefined || checked.current === path) return
    checked.current = path
    setOffer(recoverableDraft(path, content))
  }, [path, content])

  // keep the recovery copy current: every edit, and once more as the window
  // goes away (a reload or quit can land inside the debounce)
  const latest = React.useRef({ path, content })
  latest.current = { path, content }
  React.useEffect(() => {
    if (!path || content === undefined || checked.current !== path || offer) return
    const t = setTimeout(() => saveDraft(path, content), 300)
    return () => clearTimeout(t)
  }, [path, content, offer])
  React.useEffect(() => {
    const flush = (): void => {
      const { path: p, content: c } = latest.current
      if (p && c !== undefined && checked.current === p) saveDraft(p, c)
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  // Editing puts Properties on the right edge of the circuit, where the docs
  // side panel would squeeze it: Edit hides the panel and Done brings it back.
  // Only a panel this hid comes back, and reopening it yourself from the
  // Panels menu while editing keeps it open.
  const docsOpen = useAppSelector(selectPanelState).isDocsPanelOpen
  const docsOpenRef = React.useRef(docsOpen)
  docsOpenRef.current = docsOpen
  const hidDocs = React.useRef(false)
  const onEditChange = React.useCallback(
    (editing: boolean) => {
      if (editing) {
        if (docsOpenRef.current) {
          hidDocs.current = true
          dispatch(setPanelOpen({ panel: 'docs', isOpen: false }))
        }
        return
      }
      if (hidDocs.current && !docsOpenRef.current)
        dispatch(setPanelOpen({ panel: 'docs', isOpen: true }))
      hidDocs.current = false
    },
    [dispatch]
  )
  // reopened by hand while editing: it's the user's now, leave it alone on Done
  const wasDocsOpen = React.useRef(docsOpen)
  React.useEffect(() => {
    if (docsOpen && !wasDocsOpen.current) hidDocs.current = false
    wasDocsOpen.current = docsOpen
  }, [docsOpen])
  // leaving the circuit (Code/Visual tab) mid-edit gives the panel back too
  React.useEffect(
    () => () => {
      if (hidDocs.current) dispatch(setPanelOpen({ panel: 'docs', isOpen: true }))
    },
    [dispatch]
  )

  if (!file) return <LoadingHint label="Loading circuit…" />

  return (
    <div className="relative size-full">
      <CircuitViewV2
        content={file.content}
        onChange={(content) => dispatch(updateFileContent({ id: file.id, content }))}
        onOpenCode={() => {
          dispatch(revealFile(file.id))
          dispatch(setEditorView('code'))
        }}
        projectName={workspace?.name}
        onEditChange={onEditChange}
        onSaveKiCad={workspace ? (hat) => saveKiCadProject(workspace, hat) : undefined}
      />
      {offer && (
        <div className="absolute left-1/2 top-14 -translate-x-1/2 z-50 flex items-center gap-3 rounded-md border border-border-default bg-surface-card shadow-lg px-3 py-2 text-[12px]">
          <History size={14} className="text-brand shrink-0" />
          <span className="text-text-body">
            This circuit has unsaved changes from{' '}
            {new Date(offer.at).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short'
            })}
            .
          </span>
          <Button
            size="sm"
            onClick={() => {
              dispatch(updateFileContent({ id: file.id, content: offer.content }))
              setOffer(null)
            }}
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearDraft(file.path)
              setOffer(null)
            }}
          >
            Discard
          </Button>
        </div>
      )}
    </div>
  )
}
