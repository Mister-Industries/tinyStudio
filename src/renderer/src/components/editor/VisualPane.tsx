// Visual view: the full-window p5 sketch, with sketch tabs, preview and publish.

import { refreshWorkspace } from '@renderer/commands/fileCommands'
import { fileSystem } from '@renderer/lib/fileSystem'
import { enablePages, loadAccount, loadLink, pushFile, toRepoPath } from '@renderer/lib/github'
import { notify as toast } from '@renderer/lib/notify'
import { isElectron, openExternal } from '@renderer/lib/utils'
import { buildVisualExportHtml } from '@renderer/lib/visualExport'
import { useAppDispatch, useAppSelector } from '@renderer/redux'
import { setEditorView } from '@renderer/redux/editorSlice'
import { revealFile } from '@renderer/redux/fileSlice'
import { CodeXml, ExternalLink, Loader2, Plus, Sparkles, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { IconButton } from '../ui/IconButton'
import { VisualPreview } from '../VisualPreview'
import { LoadingHint } from './LoadingHint'
import { MissingFileView } from './MissingFileView'
import { NewSketchDialog } from './NewSketchDialog'
import { collectFiles, createProjectFile, findInTree, useProjectFile } from './projectFiles'
import { DEFAULT_VISUAL, sketchTemplate } from './sketchTemplates'

export function VisualPane(): React.JSX.Element | null {
  const workspace = useAppSelector((s) => s.file.workspace)
  const dispatch = useAppDispatch()

  // Which .js sketch is shown in the Visual view. Defaults to visual.js, the
  // sketch the view offers to create; other .js files are selectable too.
  const [activeSketch, setActiveSketch] = useState('visual.js')
  const [showNew, setShowNew] = useState(false)
  // Serial is owned app-wide by SerialProvider and feeds the running sketch via
  // the shared bus, so switching to/from this view doesn't reset the board.
  const [publishing, setPublishing] = useState(false)

  const jsFiles = useMemo(
    () => (workspace ? collectFiles(workspace.root, (i) => /\.js$/i.test(i.name!)) : []),
    [workspace]
  )

  // If the active sketch isn't in this project (after a project switch or a
  // delete), fall back to visual.js or the first sketch available.
  useEffect(() => {
    if (jsFiles.length && !jsFiles.some((f) => f.name === activeSketch)) {
      setActiveSketch(jsFiles.find((f) => f.name === 'visual.js')?.name ?? jsFiles[0].name!)
    }
  }, [jsFiles, activeSketch])

  const file = useProjectFile(activeSketch)

  // EditorPanel shows the start screen until a project is open.
  if (!workspace) return null

  const ws = workspace

  const createSketch = async (fileName: string, content?: string): Promise<void> => {
    try {
      await createProjectFile(
        ws,
        fileName,
        content ?? sketchTemplate(fileName.replace(/\.js$/i, ''))
      )
      setActiveSketch(fileName)
      setShowNew(false)
    } catch (e) {
      toast.error('Could not create sketch', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    }
  }

  // Build the standalone page, titled after the .ino project (not the folder).
  const buildHtml = (): string => {
    const ino = findInTree(ws.root, (i) => /\.ino$/i.test(i.name!))
    const projectName = ino?.name?.replace(/\.ino$/i, '') || ws.name || 'tinyStudio sketch'
    return buildVisualExportHtml(projectName, file?.content ?? '')
  }

  // Preview: write index.html into the project root and open it in the browser.
  const preview = async (): Promise<void> => {
    const path = `${ws.path}/index.html`
    try {
      const html = buildHtml()
      if (!isElectron()) {
        // No shell to open a local file on the web; show the page from a blob
        // URL instead. Open it before any await so the popup blocker allows it.
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        const win = window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        if (!win) {
          toast.error('Could not open preview', {
            description: 'Your browser blocked the new tab. Allow pop-ups for this site.'
          })
          return
        }
        // Keep index.html in the project too, as on desktop (best-effort).
        await fileSystem
          .writeFile(path, html)
          .then(() => refreshWorkspace(ws))
          .catch((e) => console.warn('Could not save index.html:', e))
        return
      }
      await window.api.fs.writeFile(path, html)
      await refreshWorkspace(ws)
      const err = await window.api.fs.openPath(path)
      if (err) toast.error('Could not open preview', { description: err })
      else toast.success('Preview opened in your browser', { description: path })
    } catch (e) {
      toast.error('Preview failed', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    }
  }

  // Publish: push index.html to the linked repo and turn on GitHub Pages.
  const publish = async (): Promise<void> => {
    const account = loadAccount()
    if (!account) {
      toast.info('Connect GitHub first', {
        description: 'Open the GitHub tab in the sidebar to sign in.'
      })
      return
    }
    const link = loadLink(ws.path)
    if (!link) {
      toast.info('Link this project to a repo first', {
        description: 'Use the GitHub tab to link or publish a repository.'
      })
      return
    }
    setPublishing(true)
    try {
      const html = buildHtml()
      await fileSystem.writeFile(`${ws.path}/index.html`, html)
      await refreshWorkspace(ws)
      await pushFile(
        link.remote,
        link.branch,
        // A project that lives in a repo subfolder must publish its page there,
        // not over the repo root's index.html.
        toRepoPath(link, 'index.html'),
        html,
        account.token,
        'Publish web export via tinyStudio'
      )
      const url = await enablePages(link.remote, link.branch, account.token)
      toast.success('Published to GitHub Pages', {
        description: `${url} (the first build can take a minute)`
      })
      openExternal(url)
    } catch (e) {
      toast.error('Publish failed', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="size-full flex flex-col bg-[var(--bg)]">
      {/* Sketch picker + view actions. Tabs let you keep several p5.js renders
          (asteroids.js, pong.js, …) in one project and switch between them. */}
      <div className="flex items-stretch h-[36px] border-b-[1.5px] border-[var(--border-default)] bg-[var(--bg-sunken)]">
        <div className="flex items-stretch min-w-0 overflow-x-auto">
          {jsFiles.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveSketch(f.name!)}
              title={f.name ?? undefined}
              className={`shrink-0 px-3.5 text-[13px] flex items-center border-r-[1.5px] border-[var(--border-soft)] ${
                f.name === activeSketch
                  ? 'bg-[var(--surface-card)] text-[var(--text-strong)] shadow-[inset_0_2.5px_0_0_var(--brand)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-body)]'
              }`}
            >
              {f.name}
            </button>
          ))}
          <button
            onClick={() => setShowNew(true)}
            title="New sketch"
            className="shrink-0 flex items-center px-2.5 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="flex-1" />
      </div>

      <div className="flex-1 min-h-0">
        {file ? (
          <VisualPreview
            code={file.content}
            name={file.name}
            actions={
              <>
                <IconButton
                  label="Edit code"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    dispatch(revealFile(file.id))
                    dispatch(setEditorView('code'))
                  }}
                >
                  <CodeXml size={16} />
                </IconButton>
                <IconButton label="Preview in browser" variant="ghost" size="sm" onClick={preview}>
                  <ExternalLink size={16} />
                </IconButton>
                <IconButton
                  label="Publish to GitHub Pages"
                  variant="ghost"
                  size="sm"
                  disabled={publishing}
                  onClick={publish}
                >
                  {publishing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <UploadCloud size={16} />
                  )}
                </IconButton>
              </>
            }
          />
        ) : jsFiles.length === 0 ? (
          <MissingFileView
            icon={<Sparkles size={36} />}
            title="This project has no visual sketch yet"
            description={
              <p>
                Creating one adds <code>visual.js</code> to the project folder: a p5.js serial
                plotter that draws whatever the board prints.
              </p>
            }
            action="Create visual.js"
            onAction={() => createSketch('visual.js', DEFAULT_VISUAL)}
          />
        ) : (
          <LoadingHint label="Loading visual…" />
        )}
      </div>

      <NewSketchDialog
        open={showNew}
        onOpenChange={setShowNew}
        existing={jsFiles.map((f) => f.name!)}
        onCreate={createSketch}
      />
    </div>
  )
}
