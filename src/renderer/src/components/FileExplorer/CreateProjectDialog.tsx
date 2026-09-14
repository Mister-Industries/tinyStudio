/**
 * CreateProjectDialog — name a new project, pick where it lives, done.
 *
 * The project is one folder named after the sketch, with the .ino and README
 * inside (see lib/projectLayout), so it opens as-is in the Arduino IDE too.
 * Browsers that can't write folders get the same project kept in the browser,
 * with the usual banner explaining how to keep it.
 */

import { OpenScratchProjectCommand, OpenWorkspaceCommand } from '@renderer/commands/fileCommands'
import { notify as toast } from '@renderer/lib/notify'
import { flattenSketchLayout, toSketchName } from '@renderer/lib/projectLayout'
import {
  canSaveToComputer,
  chooseProjectTarget,
  pickParentFolder,
  writeProjectFolder
} from '@renderer/lib/projectStore'
import { FilePlus2, FolderOpen, Loader2 } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { ProjectFolderPreview } from '../ProjectFolderPreview'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/Dialog'
import { Input } from '../ui/Input'
import { createProjectSchema } from './schemas'
import { createDefaultProjectFiles, getRandomProjectPlaceholder } from './utils'

export interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateProjectDialog({
  open,
  onOpenChange
}: CreateProjectDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [placeholder, setPlaceholder] = useState(getRandomProjectPlaceholder)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const local = canSaveToComputer()

  // Fresh form (and a fresh placeholder) every time the dialog opens.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setError(null)
    setPlaceholder(getRandomProjectPlaceholder())
  }, [open])

  const parsed = createProjectSchema.safeParse({ projectTitle: title })
  const validation = title.trim() && !parsed.success ? parsed.error.issues[0]?.message : null
  const sketch = toSketchName(title || placeholder)
  const previewFiles = useMemo(() => [`${sketch}.ino`, 'README.md'], [sketch])

  const create = async (): Promise<void> => {
    if (!parsed.success || busy) return
    setBusy(true)
    setError(null)
    try {
      const name = toSketchName(title)
      const files = createDefaultProjectFiles(title.trim(), name)

      if (!local) {
        await new OpenScratchProjectCommand(name, files).execute()
        onOpenChange(false)
        return
      }

      const parent = await pickParentFolder()
      if (!parent) return // picker cancelled — leave the dialog up
      const target = await chooseProjectTarget(parent, name)
      const layout = flattenSketchLayout(files, target.name)
      const root = await writeProjectFolder(parent, target, layout.files)
      await new OpenWorkspaceCommand(root).execute()
      onOpenChange(false)
      if (target.name !== name) {
        toast.info(`A ${name} folder was already there`, {
          description: `Created ${target.name} instead, so nothing was overwritten.`
        })
      }
    } catch (e) {
      console.error('Failed to create project:', e)
      setError(e instanceof Error ? e.message : 'Failed to create project. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>
            {local ? 'Name your project, then choose where to save it.' : 'Name your project.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          className="flex min-w-0 flex-col gap-3"
        >
          <label
            htmlFor="project-title"
            className="text-sm font-semibold text-[var(--text-strong)]"
          >
            Project name
          </label>
          <Input
            id="project-title"
            autoFocus
            placeholder={placeholder}
            value={title}
            disabled={busy}
            aria-invalid={!!validation}
            onChange={(e) => setTitle(e.target.value)}
          />
          {validation ? (
            <p className="text-xs text-[var(--red-on)]">{validation}</p>
          ) : (
            <ProjectFolderPreview name={sketch} files={previewFiles} />
          )}
          {error && <p className="text-xs text-[var(--red-on)]">{error}</p>}
          {!local && (
            <p className="text-[11px] leading-snug text-[var(--text-muted)]">
              This browser can&apos;t write folders on your computer, so the project stays in the
              browser for now. Open tinyStudio in Chrome or Edge, or use the desktop app, to save it
              as a folder.
            </p>
          )}
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !parsed.success}>
              {busy ? <Loader2 className="animate-spin" /> : local ? <FolderOpen /> : <FilePlus2 />}
              {local ? 'Choose location & create' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
