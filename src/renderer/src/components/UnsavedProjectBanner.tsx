/**
 * UnsavedProjectBanner: "this project only lives in your browser."
 *
 * Examples and GitHub repos open straight into browser storage, which is great
 * for trying things and easy to lose track of. This keeps that fact visible
 * from every view, with a one-click way to give the project a real folder:
 * pick a location and a folder named after the project is created there.
 */

import { saveProjectToComputer } from '@renderer/commands/fileCommands'
import { useIsBrowserOnlyProject } from '@renderer/hooks/useIsBrowserOnlyProject'
import { useRepoSync } from '@renderer/hooks/useRepoSync'
import { useAppSelector } from '@renderer/redux'
import { FolderDown, Globe, Loader2 } from 'lucide-react'
import { Button } from './ui/Button'

export function UnsavedProjectBanner(): React.JSX.Element | null {
  const workspace = useAppSelector((state) => state.file.workspace)
  const saving = useAppSelector((state) => state.editor.savingToComputer)
  const browserOnly = useIsBrowserOnlyProject()
  const { link, changed, deleted, writable } = useRepoSync()
  // One notice at a time: unpushed changes to a repo you can push to come first.
  const pushReminderShowing = !!link && writable === true && changed.length + deleted.length > 0

  if (!workspace || !browserOnly || pushReminderShowing) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] border-b-[1.5px] border-[var(--border-default)] bg-[var(--brand-soft)]">
      <Globe size={14} className="shrink-0 text-[var(--brand)]" />
      <span className="min-w-0 flex-1 truncate text-[var(--text-body)]">
        <span className="font-semibold text-[var(--text-strong)]">Editing in your browser.</span>{' '}
        {workspace.name} isn&apos;t saved to your computer yet.
      </span>
      <Button
        size="sm"
        className="h-6 shrink-0 px-2 text-[12px]"
        disabled={saving}
        title="Pick a location; a folder named after this project is created there"
        onClick={() => void saveProjectToComputer()}
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <FolderDown size={13} />}
        {saving ? 'Saving…' : 'Save to computer'}
      </Button>
    </div>
  )
}
