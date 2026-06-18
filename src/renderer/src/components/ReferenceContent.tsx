import { useAppSelector } from '@renderer/redux'
import { Folder } from 'lucide-react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import { ScrollArea } from './ui/ScrollArea'

export function ReadmeContent(): React.JSX.Element {
  const readmeContent = useAppSelector((state) => state.file.readmeContent)
  const components: Components = {
    h1: ({ children, className, ...props }) => (
      <h1 {...props} className={[className, 'text-3xl font-bold mb-4'].filter(Boolean).join(' ')}>
        {children}
      </h1>
    ),
    h2: ({ children, className, ...props }) => (
      <h2
        {...props}
        className={[className, 'text-2xl font-semibold mb-3 text-fg-1']
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </h2>
    ),
    h3: ({ children, className, ...props }) => (
      <h3
        {...props}
        className={[className, 'text-xl font-medium mb-2 text-fg-2'].filter(Boolean).join(' ')}
      >
        {children}
      </h3>
    ),
    p: ({ children, className, ...props }) => (
      <p
        {...props}
        className={[className, 'mb-4 text-sm text-fg-2 leading-relaxed']
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </p>
    ),
    ul: ({ children, className, ...props }) => (
      <ul
        {...props}
        className={[className, 'list-disc list-inside mb-4 space-y-1'].filter(Boolean).join(' ')}
      >
        {children}
      </ul>
    ),
    ol: ({ children, className, ...props }) => (
      <ol
        {...props}
        className={[className, 'list-decimal list-inside mb-4 space-y-1'].filter(Boolean).join(' ')}
      >
        {children}
      </ol>
    ),
    li: ({ children, className, ...props }) => (
      <li {...props} className={[className, 'text-fg-2'].filter(Boolean).join(' ')}>
        {children}
      </li>
    ),
    strong: ({ children, className, ...props }) => (
      <strong
        {...props}
        className={[className, 'font-bold text-fg-1'].filter(Boolean).join(' ')}
      >
        {children}
      </strong>
    ),
    em: ({ children, className, ...props }) => (
      <em {...props} className={[className, 'italic text-fg-2'].filter(Boolean).join(' ')}>
        {children}
      </em>
    ),
    code: ({ children, className, ...props }) => (
      <code
        {...props}
        className={[className, 'bg-navy-900 px-1.5 py-0.5 rounded text-sm font-mono text-pink']
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </code>
    ),
    pre: ({ children, className, ...props }) => (
      <pre
        {...props}
        className={[className, 'bg-navy-1000 border border-navy-600 p-4 rounded-lg overflow-x-auto mb-4']
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </pre>
    ),
    blockquote: ({ children, className, ...props }) => (
      <blockquote
        {...props}
        className={[className, 'border-l-4 border-cyan pl-4 italic text-fg-3 my-4']
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </blockquote>
    ),
    a: ({ children, className, ...props }) => (
      <a
        {...props}
        className={[className, 'text-cyan hover:text-cyan-bright underline']
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </a>
    )
  }
  if (readmeContent === null || readmeContent === '' || readmeContent === undefined) {
    return (
      <div className="size-full flex flex-col justify-center items-center gap-2">
        <Folder size={48} className="mb-4 opacity-50" />
        Open a project to view its documentation
      </div>
    )
  }
  return (
    <ScrollArea className="h-full pb-24">
      <ReactMarkdown components={components}>{readmeContent}</ReactMarkdown>
    </ScrollArea>
  )
}
