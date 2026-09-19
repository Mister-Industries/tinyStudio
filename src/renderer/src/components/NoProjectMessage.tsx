/**
 * NoProjectMessage: the one empty state every panel shows before a project is
 * open. Plain text, centred in whatever space the panel has, always worded
 * "Open a project to <action>".
 */
export function NoProjectMessage({ action }: { action: string }): React.JSX.Element {
  return <PanelMessage>Open a project to {action}</PanelMessage>
}

/** A short centred panel message, in the same type as NoProjectMessage. */
export function PanelMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex size-full flex-1 items-center justify-center px-6 text-center text-sm text-[var(--text-muted)]">
      {children}
    </div>
  )
}
