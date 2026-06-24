// First-run onboarding. On the very first launch we offer to get the user
// started with example projects:
//   • Desktop — download the latest examples to Documents/tinyStudio Examples and
//     open them, so they're on disk and ready to flash.
//   • Web — there's nothing to install; we point the user at the live Examples tab.
// Shown once (gated by localStorage), and skipped entirely when the app was
// opened via a /<owner>/<repo>/<path> deep link (the user came for a project).

import { Download, Loader2, Zap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { OpenWorkspaceCommand } from '@renderer/commands/fileCommands'
import { installExamplesToDisk } from '@renderer/lib/examples'
import { parseProjectRoute } from '@renderer/lib/projectRouting'
import { isElectron } from '@renderer/lib/utils'
import { setPanelOpen, useAppDispatch } from '@renderer/redux'
import { Button } from './ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/Dialog'

const ONBOARDED_KEY = 'tinystudio.onboarded'

function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1')
  } catch {
    /* ignore */
  }
}

function shouldShow(): boolean {
  try {
    if (localStorage.getItem(ONBOARDED_KEY)) return false
  } catch {
    return false
  }
  // Opened via a deep link → the user came for a specific project, not a welcome.
  return !parseProjectRoute()
}

export function WelcomeDialog(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(shouldShow)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const desktop = isElectron()

  const skip = (): void => {
    markOnboarded()
    setOpen(false)
  }

  // Desktop: download examples to disk and open them.
  const download = async (): Promise<void> => {
    setBusy(true)
    setProgress('Preparing…')
    try {
      const { dir, installed } = await installExamplesToDisk(setProgress)
      markOnboarded()
      setOpen(false)
      toast.success(`Installed ${installed} example${installed === 1 ? '' : 's'}`, {
        description: dir
      })
      await new OpenWorkspaceCommand(dir).execute()
    } catch (e) {
      // Keep the dialog open so the user can retry or skip.
      toast.error('Could not download examples', {
        description: e instanceof Error ? e.message : String(e)
      })
      setBusy(false)
      setProgress('')
    }
  }

  // Web: nothing to install — open the docs panel where the Examples tab lives.
  const browse = (): void => {
    markOnboarded()
    setOpen(false)
    dispatch(setPanelOpen({ panel: 'docs', isOpen: true }))
    toast('Browse ready-made projects in the Examples tab.')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) skip()
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap size={18} className="text-primary" />
            Welcome to tinyStudio
          </DialogTitle>
          <DialogDescription>
            {desktop
              ? 'Start with a set of example projects you can open, edit, wire up, and flash. We can download the latest ones for you now.'
              : 'Browse ready-made example projects and open any of them in one click.'}
          </DialogDescription>
        </DialogHeader>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            {progress || 'Downloading…'}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={skip} disabled={busy}>
            Skip for now
          </Button>
          {desktop ? (
            <Button onClick={download} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />}
              Download examples
            </Button>
          ) : (
            <Button onClick={browse}>
              <Zap />
              Browse examples
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
