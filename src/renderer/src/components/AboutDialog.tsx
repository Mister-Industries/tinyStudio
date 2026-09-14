/**
 * AboutDialog — version, licence and the third-party work tinyStudio ships with.
 * Opened from the tinyStudio menu in the header.
 */

import { openExternal } from '@renderer/lib/utils'
import { version } from '../../../../package.json'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/Dialog'
import { Button } from './ui/Button'

const REPO_URL = 'https://github.com/Mister-Industries/tinyStudio'

interface Credit {
  name: string
  licence: string
  url: string
  note?: string
}

const CREDITS: Credit[] = [
  {
    name: 'Fritzing parts library',
    licence: 'CC-BY-SA 3.0',
    url: 'https://github.com/fritzing/fritzing-parts',
    note: 'Breadboard and schematic art for the Core parts'
  },
  {
    name: 'arduino-cli',
    licence: 'GPL-3.0',
    url: 'https://github.com/arduino/arduino-cli',
    note: 'Compiles and uploads sketches'
  },
  {
    name: 'ngspice (via eecircuit-engine)',
    licence: 'BSD-3-Clause / MIT',
    url: 'https://ngspice.sourceforge.io',
    note: 'Circuit simulation'
  },
  { name: 'p5.js', licence: 'LGPL-2.1', url: 'https://p5js.org', note: 'Visual sketches' },
  { name: 'Monaco Editor', licence: 'MIT', url: 'https://github.com/microsoft/monaco-editor' },
  { name: 'Electron', licence: 'MIT', url: 'https://www.electronjs.org' },
  { name: 'Mermaid', licence: 'MIT', url: 'https://github.com/mermaid-js/mermaid' },
  { name: 'uPlot', licence: 'MIT', url: 'https://github.com/leeoniya/uPlot' },
  {
    name: 'DOMPurify',
    licence: 'MPL-2.0 or Apache-2.0',
    url: 'https://github.com/cure53/DOMPurify'
  },
  { name: 'Lucide icons', licence: 'ISC', url: 'https://lucide.dev' }
]

export function AboutDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            <span className="font-medium text-[var(--text-muted)]">tiny</span>Studio {version}
          </DialogTitle>
          <DialogDescription>
            Write and flash embedded code, design circuits and build visuals, by MR.INDUSTRIES. Free
            software under the GNU General Public License v3.0 or later.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            Built with
          </div>
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto text-[13px]">
            {CREDITS.map((c) => (
              <li key={c.name} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <button
                    type="button"
                    className="cursor-pointer text-left font-semibold text-[var(--text-body)] hover:text-[var(--brand)] hover:underline"
                    onClick={() => openExternal(c.url)}
                  >
                    {c.name}
                  </button>
                  {c.note && <span className="text-[var(--text-muted)]"> — {c.note}</span>}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                  {c.licence}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => openExternal(REPO_URL)}>
            Source code
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
