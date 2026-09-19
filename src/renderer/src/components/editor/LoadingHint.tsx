import { Loader2 } from 'lucide-react'

export function LoadingHint({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
      <Loader2 size={22} className="animate-spin text-[var(--brand)]" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
