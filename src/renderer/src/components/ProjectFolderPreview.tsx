// A tiny read-only folder listing: shows what a project will look like on disk
// before it's written (Create and Save dialogs).

import { File, Folder } from 'lucide-react'

export function ProjectFolderPreview({
  name,
  files,
  max = 5
}: {
  name: string
  files: string[]
  max?: number
}): React.JSX.Element {
  const shown = files.slice(0, max)
  const more = files.length - shown.length
  return (
    <div className="min-w-0 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--border-soft)] bg-[var(--bg-sunken)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--text-body)]">
      <div className="flex min-w-0 items-center gap-1.5 font-semibold text-[var(--text-strong)]">
        <Folder size={13} className="shrink-0 text-[var(--brand)]" />
        <span className="truncate">{name}/</span>
      </div>
      {shown.map((f) => (
        <div key={f} className="flex min-w-0 items-center gap-1.5 pl-5">
          <File size={12} className="shrink-0 text-[var(--text-faint)]" />
          <span className="truncate">{f}</span>
        </div>
      ))}
      {more > 0 && <div className="pl-5 text-[var(--text-faint)]">+ {more} more</div>}
    </div>
  )
}
