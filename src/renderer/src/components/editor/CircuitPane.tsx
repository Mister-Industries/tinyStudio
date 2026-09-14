// Circuit view: the full-window circuit.json editor (docs/circuit-view-tech-spec.md).

import { RefreshWorkspaceCommand } from '@renderer/commands/fileCommands'
import { fileSystem } from '@renderer/lib/fileSystem'
import { useAppDispatch, useAppSelector } from '@renderer/redux'
import { setEditorView, setPanelOpen } from '@renderer/redux/editorSlice'
import { revealFile, updateFileContent } from '@renderer/redux/fileSlice'
import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyDoc, parseCircuitFile, serializeDoc } from '../../circuit'
import { CircuitViewV2 } from '../../circuit/views/CircuitView'
import { LoadingHint } from './LoadingHint'
import { findInTree, useProjectFile } from './projectFiles'

/**
 * The native file is `circuit.json` (spec §4, §13). On first open of a project
 * that only has a v1 `diagram.json`, migrate it on disk: write `circuit.json`
 * (converted) and `diagram.json.bak` (verbatim copy).
 */
export function CircuitPane(): React.JSX.Element | null {
  const workspace = useAppSelector((s) => s.file.workspace)
  const [ready, setReady] = useState(false)
  const adopting = useRef(false)

  useEffect(() => {
    setReady(false)
    if (!workspace || adopting.current) return
    if (findInTree(workspace.root, (i) => i.name === 'circuit.json')) {
      setReady(true)
      return
    }
    const diagram = findInTree(workspace.root, (i) => i.name === 'diagram.json')
    if (!diagram) {
      setReady(true) // fresh project — useProjectFile seeds an empty circuit.json
      return
    }
    adopting.current = true
    ;(async () => {
      try {
        const old = await fileSystem.readFile(diagram.path!)
        const { doc } = parseCircuitFile(old)
        await fileSystem.writeFile(`${workspace.path}/circuit.json`, serializeDoc(doc))
        await fileSystem.writeFile(`${workspace.path}/diagram.json.bak`, old)
        await new RefreshWorkspaceCommand(workspace).execute()
      } catch (e) {
        console.error('circuit.json adoption failed:', e)
      } finally {
        adopting.current = false
        setReady(true)
      }
    })()
  }, [workspace])

  // EditorPanel shows the start screen until a project is open.
  if (!workspace) return null
  if (!ready) return <LoadingHint label="Preparing circuit…" />
  return <CircuitFileEditor />
}

function CircuitFileEditor(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const makeDefault = useCallback(() => serializeDoc(emptyDoc()), [])
  const file = useProjectFile('circuit.json', makeDefault)

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
