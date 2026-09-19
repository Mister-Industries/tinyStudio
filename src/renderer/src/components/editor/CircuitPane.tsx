// Circuit view: the full-window circuit.json editor (docs/circuit-view-tech-spec.md).

import { fileSystem } from '@renderer/lib/fileSystem'
import { notify as toast } from '@renderer/lib/notify'
import { useAppDispatch, useAppSelector } from '@renderer/redux'
import { setEditorView, setPanelOpen } from '@renderer/redux/editorSlice'
import { revealFile, updateFileContent, type Workspace } from '@renderer/redux/fileSlice'
import { CircuitBoard, FileClock } from 'lucide-react'
import { emptyDoc, parseCircuitFile, serializeDoc } from '../../circuit'
import { CircuitViewV2 } from '../../circuit/views/CircuitView'
import { LoadingHint } from './LoadingHint'
import { MissingFileView } from './MissingFileView'
import { createProjectFile, findInTree, useProjectFile } from './projectFiles'

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
  const file = useProjectFile('circuit.json')

  if (!file) return <LoadingHint label="Loading circuit…" />

  return (
    <CircuitViewV2
      content={file.content}
      onChange={(content) => dispatch(updateFileContent({ id: file.id, content }))}
      onOpenCode={() => {
        dispatch(revealFile(file.id))
        dispatch(setEditorView('code'))
      }}
      onEditChange={(editing) => {
        dispatch(setPanelOpen({ panel: 'docs', isOpen: !editing }))
      }}
    />
  )
}
