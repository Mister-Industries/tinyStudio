// StartScreen — what the editor shows when no project is open.
//
// Three ways in, each one big card: make something new, open something that
// exists (a folder or a GitHub repo), or learn from an example. Recent projects
// sit underneath for picking up where you left off.
//
// The cards sit in a container query rather than a media query because the
// editor column is resizable: three squares when there's room, a stack of rows
// when the side panels squeeze it.

import { openProjectDialog, showExamples, useAppDispatch } from '@renderer/redux'
import { FilePlus2, FolderOpen, Zap, type LucideIcon } from 'lucide-react'
import { RecentProjects } from './RecentProjects'

interface StartCard {
  key: string
  title: string
  description: string
  icon: LucideIcon
  className: string
  iconClassName: string
  descriptionClassName: string
  onClick: () => void
}

export function StartScreen(): React.JSX.Element {
  const dispatch = useAppDispatch()

  const cards: StartCard[] = [
    {
      key: 'create',
      title: 'Create new',
      description: 'A blank sketch in a folder of its own',
      icon: FilePlus2,
      className: 'tactile bg-primary text-white [--_edge:var(--brand-deep)]',
      iconClassName: 'bg-white/20 text-white',
      descriptionClassName: 'text-white/80',
      onClick: () => dispatch(openProjectDialog('create'))
    },
    {
      key: 'open',
      title: 'Open existing',
      description: 'A folder on this computer or a GitHub repo',
      icon: FolderOpen,
      className: 'tactile-bordered bg-card text-[var(--text-strong)]',
      iconClassName: 'bg-[var(--brand-soft)] text-[var(--brand)]',
      descriptionClassName: 'text-[var(--text-muted)]',
      onClick: () => dispatch(openProjectDialog('open'))
    },
    {
      key: 'example',
      title: 'Try an example',
      description: 'Blink, sensors, games and more — ready to run',
      icon: Zap,
      className: 'tactile-bordered bg-card text-[var(--text-strong)]',
      // Same treatment as "Open existing": a pale tile with the icon in the
      // colour's deeper shade.
      iconClassName: 'bg-[var(--yellow-soft)] text-[var(--yellow-deep)]',
      descriptionClassName: 'text-[var(--text-muted)]',
      onClick: () => dispatch(showExamples())
    }
  ]

  return (
    <div className="size-full overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center gap-7 px-6 py-8">
        <div className="text-center">
          <div className="text-[var(--text-strong)] text-lg font-bold tracking-[-0.01em]">
            What are we building today?
          </div>
          <div className="text-[var(--text-muted)] text-xs mt-1">
            Start fresh, pick up a project, or learn from an example.
          </div>
        </div>

        <div className="@container w-full max-w-[620px]">
          <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
            {cards.map(({ key, title, description, icon: Icon, ...card }) => (
              <button
                key={key}
                type="button"
                onClick={card.onClick}
                className={`flex cursor-pointer items-center gap-3 rounded-[var(--radius-lg)] p-4 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] @md:aspect-square @md:flex-col @md:items-start @md:justify-between @md:p-5 ${card.className}`}
              >
                <span
                  className={`flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] ${card.iconClassName}`}
                >
                  <Icon size={22} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-[15px] font-bold leading-tight">{title}</span>
                  <span className={`text-xs leading-snug ${card.descriptionClassName}`}>
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <RecentProjects limit={5} className="w-full max-w-[620px]" />
      </div>
    </div>
  )
}
