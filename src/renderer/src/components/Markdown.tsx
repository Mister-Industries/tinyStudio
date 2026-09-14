/**
 * Markdown — shared GitHub-flavored markdown renderer.
 *
 * Used by both the Documentation tab and the Studio AI chat so they stylize
 * markdown the same way. Fenced ```mermaid blocks are rendered as diagrams
 * instead of code; everything else falls back to themed HTML elements.
 */

import mermaid from 'mermaid'
import React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Initialize mermaid once for the whole renderer. `startOnLoad: false` because
// we drive rendering ourselves from <MermaidDiagram />.
let mermaidTheme: 'dark' | 'default' | null = null

/** Configure mermaid for the app's light or dark mode; a no-op when unchanged. */
function ensureMermaid(dark: boolean): void {
  const theme = dark ? 'dark' : 'default'
  if (mermaidTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // Never let mermaid inject its "Syntax error" bomb graphic into the DOM —
    // we render our own inline fallback instead.
    suppressErrorRendering: true,
    theme,
    themeVariables: { fontFamily: 'inherit' }
  })
  mermaidTheme = theme
}

/** True while the app is in dark mode (ThemeProvider puts `dark` on <html>). */
function useDarkMode(): boolean {
  const read = (): boolean => document.documentElement.classList.contains('dark')
  const [dark, setDark] = React.useState(read)
  React.useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/** Recursively flatten React markdown children into plain text. */
function childrenToText(children: React.ReactNode): string {
  if (children == null) return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children)
  }
  return ''
}

/** Inspect a <pre>'s child <code> element for its language and source text. */
function getCodeInfo(children: React.ReactNode): { lang: string | null; text: string } | null {
  const child = React.Children.toArray(children)[0]
  if (!React.isValidElement(child)) return null
  const props = child.props as { className?: string; children?: React.ReactNode }
  const match = /language-(\w+)/.exec(props.className ?? '')
  return { lang: match ? match[1] : null, text: childrenToText(props.children) }
}

function MermaidDiagram({ chart }: { chart: string }): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const dark = useDarkMode()

  React.useEffect(() => {
    ensureMermaid(dark)
    let cancelled = false
    const id = `mermaid-${Math.random().toString(36).slice(2)}`
    ;(async () => {
      try {
        // Validate first (suppressErrors → returns false instead of throwing/
        // injecting), so an invalid diagram never touches the DOM.
        const ok = await mermaid.parse(chart, { suppressErrors: true })
        if (!ok) {
          if (!cancelled) setError('invalid diagram')
          return
        }
        const { svg } = await mermaid.render(id, chart)
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        // belt-and-suspenders: remove any stray node mermaid may have left
        document.getElementById('d' + id)?.remove()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chart, dark])

  if (error) {
    return (
      <pre className="bg-[var(--bg-sunken)] border border-red-500/50 text-red-300 p-3 rounded-lg overflow-x-auto text-xs mb-4 whitespace-pre-wrap">
        {chart}
      </pre>
    )
  }
  return <div ref={ref} className="my-4 flex justify-center overflow-x-auto [&_svg]:max-w-full" />
}

const components: Components = {
  h1: ({ children, className, ...props }) => (
    <h1
      {...props}
      className={[className, 'text-xl font-bold mb-3 text-[var(--text-strong)] tracking-[-0.02em]']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </h1>
  ),
  h2: ({ children, className, ...props }) => (
    <h2
      {...props}
      className={[className, 'text-base font-bold mb-2 text-[var(--text-strong)]']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </h2>
  ),
  h3: ({ children, className, ...props }) => (
    <h3
      {...props}
      className={[className, 'text-sm font-semibold mb-1.5 text-[var(--text-body)]']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </h3>
  ),
  p: ({ children, className, ...props }) => (
    <p
      {...props}
      className={[className, 'mb-3 text-sm text-[var(--text-body)] leading-relaxed']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </p>
  ),
  ul: ({ children, className, ...props }) => (
    <ul
      {...props}
      className={[className, 'list-disc list-inside mb-3 space-y-1 text-sm']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </ul>
  ),
  ol: ({ children, className, ...props }) => (
    <ol
      {...props}
      className={[className, 'list-decimal list-inside mb-3 space-y-1 text-sm']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </ol>
  ),
  li: ({ children, className, ...props }) => (
    <li {...props} className={[className, 'text-[var(--text-body)]'].filter(Boolean).join(' ')}>
      {children}
    </li>
  ),
  strong: ({ children, className, ...props }) => (
    <strong
      {...props}
      className={[className, 'font-bold text-[var(--text-strong)]'].filter(Boolean).join(' ')}
    >
      {children}
    </strong>
  ),
  em: ({ children, className, ...props }) => (
    <em
      {...props}
      className={[className, 'italic text-[var(--text-body)]'].filter(Boolean).join(' ')}
    >
      {children}
    </em>
  ),
  code: ({ children, className, ...props }) => (
    <code
      {...props}
      className={[
        className,
        'bg-[var(--bg-raised)] px-1.5 py-0.5 rounded text-sm font-mono text-[var(--brand)]'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </code>
  ),
  pre: ({ children, className, ...props }) => {
    const info = getCodeInfo(children)
    if (info?.lang === 'mermaid') return <MermaidDiagram chart={info.text} />
    return (
      <pre
        {...props}
        className={[
          className,
          'bg-[var(--bg-sunken)] border border-[var(--border-default)] p-3 rounded-lg overflow-x-auto max-w-full text-xs mb-4 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[var(--text-body)]'
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </pre>
    )
  },
  blockquote: ({ children, className, ...props }) => (
    <blockquote
      {...props}
      className={[
        className,
        'border-l-4 border-[var(--brand)] pl-4 italic text-[var(--text-muted)] my-4'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, className, href, ...props }) => {
    // Web and mail links open outside the app (a new tab, or the system browser
    // on desktop). Relative links point into a repo the preview can't follow,
    // so they do nothing rather than navigate the app away.
    const external = !!href && /^(https?:|mailto:)/i.test(href)
    const inPage = !!href && href.startsWith('#')
    return (
      <a
        {...props}
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        onClick={external || inPage ? undefined : (e) => e.preventDefault()}
        className={[className, 'text-[var(--brand)] hover:text-[var(--brand)] underline']
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </a>
    )
  },
  hr: ({ className, ...props }) => (
    <hr
      {...props}
      className={[className, 'border-[var(--border-default)] my-4'].filter(Boolean).join(' ')}
    />
  ),
  table: ({ children, className, ...props }) => (
    <div className="overflow-x-auto mb-4">
      <table
        {...props}
        className={[className, 'w-full text-sm border-collapse'].filter(Boolean).join(' ')}
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children, className, ...props }) => (
    <th
      {...props}
      className={[
        className,
        'border border-[var(--border-default)] px-3 py-1.5 text-left font-semibold text-[var(--text-strong)] bg-[var(--bg-raised)]'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </th>
  ),
  td: ({ children, className, ...props }) => (
    <td
      {...props}
      className={[
        className,
        'border border-[var(--border-default)] px-3 py-1.5 text-[var(--text-body)]'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </td>
  )
}

export function Markdown({
  children,
  className
}: {
  children: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={['[&>*:last-child]:mb-0', className].filter(Boolean).join(' ')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
