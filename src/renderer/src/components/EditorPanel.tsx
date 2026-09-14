/**
 * EditorPanel — the main work area. Shows the start screen until a project is
 * open, then whichever view the header switch selects: Code, Circuit or Visual
 * (each in components/editor/).
 */

import { loader } from '@monaco-editor/react'
import { useAppSelector } from '@renderer/redux'
import { selectEditorView } from '@renderer/redux/editorSlice'
import * as monaco from 'monaco-editor'
import { useEffect, useState } from 'react'
import { CircuitPane } from './editor/CircuitPane'
import { CodeView } from './editor/CodeView'
import { VisualPane } from './editor/VisualPane'
import { MakeItMine } from './MakeItMine'
import { StartScreen } from './StartScreen'
import { UnsavedProjectBanner } from './UnsavedProjectBanner'

loader.config({ monaco })

export function EditorPanel({ size }: { size: number }): React.JSX.Element {
  const editorView = useAppSelector(selectEditorView)
  const hasWorkspace = useAppSelector((s) => s.file.workspace !== null)
  // Track viewport height so the panel re-measures on resize / fullscreen toggle
  // (otherwise the height is computed once from a stale window.innerHeight and
  // the layout — and its buttons — break after going fullscreen).
  const [winHeight, setWinHeight] = useState(window.innerHeight)
  useEffect(() => {
    const onResize = (): void => setWinHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const pixelSize = Math.round((size / 100) * (winHeight - 92))

  return (
    <div className="flex flex-col bg-[var(--bg-raised)]" style={{ height: `${pixelSize}px` }}>
      {/* Project notices — above the view switch so they're visible from Code,
          Circuit and Visual alike. At most one shows: "only in your browser"
          first, then (once saved) the read-only example's "make it mine". */}
      <UnsavedProjectBanner />
      <MakeItMine />
      {/* Until a project is open, the start screen stands in for every view —
          switching to Circuit or Visual has nothing to show without one. */}
      {!hasWorkspace ? (
        <StartScreen />
      ) : editorView === 'circuit' ? (
        <CircuitPane />
      ) : editorView === 'visual' ? (
        <VisualPane />
      ) : (
        <CodeView />
      )}
    </div>
  )
}
