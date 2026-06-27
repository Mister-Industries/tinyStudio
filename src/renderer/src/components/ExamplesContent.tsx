// Examples browser. Pulls a manifest of ready-to-open projects from the public
// examples repo and opens any of them straight into the editor (via the virtual
// workspace) — no local folder pick, no clone. Each card maps to a
// /<owner>/<repo>/<path> deep link.

import { Loader2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { notify as toast } from '@renderer/lib/notify'
import { fetchExamplesManifest, type ExampleEntry } from '@renderer/lib/examples'
import { navigateToProject } from '@renderer/lib/projectRouting'
import { Button } from './ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card'
import { ScrollArea } from './ui/ScrollArea'

export function ExamplesContent(): React.JSX.Element {
  const [examples, setExamples] = useState<ExampleEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [openingPath, setOpeningPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchExamplesManifest()
      .then((data) => {
        if (cancelled) return
        setExamples(data)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const open = async (ex: ExampleEntry): Promise<void> => {
    const key = `${ex.owner}/${ex.repo}/${ex.path}`
    setOpeningPath(key)
    try {
      await navigateToProject(ex.owner, ex.repo, ex.path)
    } catch (e) {
      toast.error('Could not open example', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setOpeningPath(null)
    }
  }

  return (
    <div className="size-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-4 text-primary text-sm font-semibold border-b border-border mb-4 shrink-0">
        <Zap size={16} />
        Examples
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-4 px-1">
          {status === 'loading' && (
            <div className="flex items-center gap-2 px-3 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Loading examples…
            </div>
          )}

          {status === 'error' && (
            <p className="px-3 text-sm text-muted-foreground">
              Couldn&apos;t load examples. Check your connection and try again.
            </p>
          )}

          {status === 'ready' && examples.length === 0 && (
            <p className="px-3 text-sm text-muted-foreground">No examples available yet.</p>
          )}

          {examples.map((example) => {
            const key = `${example.owner}/${example.repo}/${example.path}`
            const opening = openingPath === key
            return (
              <Card key={key}>
                <CardHeader>
                  <CardTitle>{example.title}</CardTitle>
                  <CardDescription>{example.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {example.board && (
                    <p className="mb-3 text-xs text-muted-foreground">Board: {example.board}</p>
                  )}
                  <Button onClick={() => open(example)} disabled={opening}>
                    {opening ? <Loader2 className="animate-spin" /> : <Zap />}
                    {opening ? 'Opening…' : 'Open example'}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
