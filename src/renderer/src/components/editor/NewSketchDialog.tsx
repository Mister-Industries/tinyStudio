import { useEffect, useState } from 'react'
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

export function NewSketchDialog({
  open,
  onOpenChange,
  existing,
  onCreate
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  existing: string[]
  onCreate: (fileName: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')

  // Reset the field each time the dialog opens.
  useEffect(() => {
    if (open) setName('')
  }, [open])

  const trimmed = name.trim()
  const fileName = trimmed ? (/\.js$/i.test(trimmed) ? trimmed : `${trimmed}.js`) : ''
  const duplicate = !!fileName && existing.includes(fileName)
  const invalid = !trimmed || /[\\/:*?"<>|]/.test(trimmed) || duplicate

  const submit = (): void => {
    if (!invalid) onCreate(fileName)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New p5.js sketch</DialogTitle>
          <DialogDescription>
            Creates a new <span className="font-mono">.js</span> sketch in your project. Switch
            between sketches with the tabs in the Visual view.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Input
            autoFocus
            placeholder="asteroids"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {duplicate && (
            <p className="text-xs text-[var(--status-error)]">
              A file named <span className="font-mono">{fileName}</span> already exists.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={invalid} onClick={submit}>
            Create sketch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
