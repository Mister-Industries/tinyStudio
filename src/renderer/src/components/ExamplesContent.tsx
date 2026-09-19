// Examples browser. Pulls a manifest of ready-to-open projects from the public
// examples repo and opens any of them straight into the editor (via the virtual
// workspace): no local folder pick, no clone. Each card maps to a
// /<owner>/<repo>/<path> deep link.
//
// Finding the right example is the job here, so the list is searchable and
// filterable by tag. Two things make that readable at a glance:
//
//   - Board/expansion tags are colour-coded to the board's real solder mask,
//     so "which examples run on my tinySniff" is a colour, not a read.
//   - Board filters sit in the always-visible row; topic filters live behind
//     the Filters disclosure, so the default view stays calm.
//
// Filters AND together (each one narrows further) and every chip carries the
// count it would yield, with zero-result chips dimmed, so you can't filter
// your way into an empty list by accident.

import { BookOpen, Loader2, Search, SlidersHorizontal, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { notify as toast } from '@renderer/lib/notify'
import { selectExamplesFlash, useAppSelector } from '@renderer/redux'
import { fetchExamplesManifest, matchesQuery, type ExampleEntry } from '@renderer/lib/examples'
import {
  compareTags,
  FACET_LABEL,
  FACET_ORDER,
  getTagMeta,
  type TagFacet
} from '@renderer/lib/exampleTags'
import { navigateToProject } from '@renderer/lib/projectRouting'
import { Button } from './ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card'
import { Input } from './ui/Input'
import { ScrollArea } from './ui/ScrollArea'
import { ExampleTag } from './ExampleTag'

// Display order + labels for the manifest's `category` field. Anything with an
// unknown (or missing) category falls into "More examples" at the bottom, so a
// new category added to the manifest still shows up rather than disappearing.
const CATEGORY_ORDER = ['basics', 'advanced', 'hats'] as const
const CATEGORY_LABEL: Record<string, string> = {
  basics: 'Basics',
  advanced: 'Advanced',
  hats: 'tinyHATs',
  other: 'More examples'
}

function groupByCategory(list: ExampleEntry[]): Array<[string, ExampleEntry[]]> {
  const groups = new Map<string, ExampleEntry[]>()
  for (const ex of list) {
    const key = ex.category && CATEGORY_ORDER.includes(ex.category as never) ? ex.category : 'other'
    const bucket = groups.get(key)
    if (bucket) bucket.push(ex)
    else groups.set(key, [ex])
  }
  const rank = (k: string): number => {
    const i = CATEGORY_ORDER.indexOf(k as never)
    return i === -1 ? CATEGORY_ORDER.length : i
  }
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
}

/** An example matches when it carries every selected tag (filters AND). */
function matchesTags(ex: ExampleEntry, selected: string[]): boolean {
  if (selected.length === 0) return true
  const tags = ex.tags ?? []
  return selected.every((t) => tags.includes(t))
}

// The last "Try an example" flash that focused the search box (module scope, so
// a remount doesn't steal focus again for an old one).
let flashFocused = 0

export function ExamplesContent(): React.JSX.Element {
  const [examples, setExamples] = useState<ExampleEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const flash = useAppSelector(selectExamplesFlash)
  const searchRef = useRef<HTMLInputElement>(null)

  // Sent here from the start screen: land in the search box, ready to type.
  useEffect(() => {
    if (status !== 'ready' || flash <= flashFocused) return
    flashFocused = flash
    searchRef.current?.focus({ preventScroll: true })
  }, [flash, status])
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showAllFilters, setShowAllFilters] = useState(false)

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

  const toggleTag = (slug: string): void =>
    setSelectedTags((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug]
    )

  const clearAll = (): void => {
    setQuery('')
    setSelectedTags([])
  }

  // Every tag present in the manifest, grouped by facet, in vocabulary order.
  const tagsByFacet = useMemo(() => {
    const seen = new Set<string>()
    for (const ex of examples) for (const t of ex.tags ?? []) seen.add(t)
    const byFacet = new Map<TagFacet, string[]>()
    for (const slug of [...seen].sort(compareTags)) {
      const facet = getTagMeta(slug).facet
      const bucket = byFacet.get(facet)
      if (bucket) bucket.push(slug)
      else byFacet.set(facet, [slug])
    }
    return byFacet
  }, [examples])

  const visible = useMemo(
    () => examples.filter((ex) => matchesTags(ex, selectedTags) && matchesQuery(ex, query)),
    [examples, selectedTags, query]
  )

  // How many results each chip would yield if it were toggled on now, so a
  // chip that leads nowhere can be dimmed instead of producing an empty list.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const ex of examples) {
      if (!matchesQuery(ex, query)) continue
      for (const t of ex.tags ?? []) {
        const others = selectedTags.filter((s) => s !== t)
        if (matchesTags(ex, others)) counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    return counts
  }, [examples, selectedTags, query])

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

  const boardTags = tagsByFacet.get('board') ?? []
  const topicFacets = FACET_ORDER.filter(
    (f) => f !== 'board' && (tagsByFacet.get(f)?.length ?? 0) > 0
  )
  const hasTopicFilters = topicFacets.length > 0
  const filtering = query.trim().length > 0 || selectedTags.length > 0

  const renderChip = (slug: string): React.JSX.Element => (
    <ExampleTag
      key={slug}
      slug={slug}
      selected={selectedTags.includes(slug)}
      count={tagCounts.get(slug) ?? 0}
      disabled={!selectedTags.includes(slug) && (tagCounts.get(slug) ?? 0) === 0}
      onToggle={toggleTag}
    />
  )

  return (
    <div className="size-full flex flex-col">
      {/* ── search + filters ─────────────────────────────────────────────── */}
      {status === 'ready' && examples.length > 0 && (
        <div className="flex flex-col gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-raised)] p-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
              />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search examples: try “i2c”, “blink”, “tinySniff”…"
                aria-label="Search examples"
                className="pl-9 pr-9"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] p-1 text-[var(--text-faint)] hover:bg-[var(--bg-sunken)] hover:text-[var(--text-body)]"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {hasTopicFilters && (
              <Button
                variant="ghost"
                onClick={() => setShowAllFilters((v) => !v)}
                aria-expanded={showAllFilters}
              >
                <SlidersHorizontal />
                Filters
              </Button>
            )}
          </div>

          {/* Boards stay visible: the colour-coded row is the main axis. */}
          {boardTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">{boardTags.map(renderChip)}</div>
          )}

          {showAllFilters &&
            topicFacets.map((facet) => (
              <div key={facet} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                  {FACET_LABEL[facet]}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(tagsByFacet.get(facet) ?? []).map(renderChip)}
                </div>
              </div>
            ))}

          {filtering && (
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
              <span>
                {visible.length} of {examples.length} example{examples.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={clearAll}
                className="font-medium text-[var(--brand)] hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── results ──────────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-6 p-5">
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

          {status === 'ready' && examples.length > 0 && visible.length === 0 && (
            <div className="flex flex-col items-start gap-3 px-3 py-6">
              <p className="text-sm text-muted-foreground">
                No examples match {query.trim() ? `“${query.trim()}”` : 'those filters'}.
              </p>
              <Button variant="ghost" onClick={clearAll}>
                <X />
                Clear filters
              </Button>
            </div>
          )}

          {groupByCategory(visible).map(([category, group]) => (
            <section key={category} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between px-1">
                <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  {CATEGORY_LABEL[category] ?? category}
                </h3>
                <span className="text-xs text-muted-foreground">{group.length}</span>
              </div>

              {group.map((example) => {
                const key = `${example.owner}/${example.repo}/${example.path}`
                const opening = openingPath === key
                return (
                  <Card key={key}>
                    <CardHeader>
                      <CardTitle>{example.title}</CardTitle>
                      <CardDescription>{example.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(example.tags?.length ?? 0) > 0 ? (
                        <div className="mb-3 flex flex-wrap items-center gap-1.5">
                          {example.tags?.map((slug) => (
                            <ExampleTag
                              key={slug}
                              slug={slug}
                              selected={selectedTags.includes(slug)}
                              onToggle={toggleTag}
                            />
                          ))}
                        </div>
                      ) : (
                        // Untagged entry (an older manifest): fall back to the
                        // free-text board line rather than showing nothing.
                        example.board && (
                          <p className="mb-3 text-xs text-muted-foreground">
                            Board: {example.board}
                          </p>
                        )
                      )}
                      <div className="flex items-center gap-2">
                        <Button variant="warning" onClick={() => open(example)} disabled={opening}>
                          {opening ? <Loader2 className="animate-spin" /> : <Zap />}
                          {opening ? 'Opening…' : 'Open example'}
                        </Button>
                        {example.docsUrl && (
                          <Button variant="ghost" asChild>
                            <a href={example.docsUrl} target="_blank" rel="noopener noreferrer">
                              <BookOpen />
                              Docs
                            </a>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
