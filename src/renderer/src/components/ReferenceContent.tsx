import { useAppSelector } from '@renderer/redux'
import ReactMarkdown from 'react-markdown'
import { ScrollArea } from './ui/ScrollArea'

export function ReadmeContent(): React.JSX.Element {
  const readmeContent = useAppSelector((state) => state.file.readmeContent)

  const components = {
    h1: ({ children }) => <h1 className="text-3xl font-bold mb-4">{children}</h1>,
    h2: ({ children }) => <h2 className="text-2xl font-semibold mb-3 text-gray-800">{children}</h2>,
    h3: ({ children }) => <h3 className="text-xl font-medium mb-2 text-gray-700">{children}</h3>,
    p: ({ children }) => <p className="mb-4 text-sm text-gray-600 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>,
    li: ({ children }) => <li className="text-gray-600">{children}</li>,
    strong: ({ children }) => <strong className="font-bold text-gray-900">{children}</strong>,
    em: ({ children }) => <em className="italic text-gray-700">{children}</em>,
    code: ({ children }) => (
      <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono text-red-600">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto mb-4">{children}</pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-blue-500 pl-4 italic text-gray-600 my-4">
        {children}
      </blockquote>
    ),
    a: ({ children, ...props }) => (
      <a {...props} className="text-blue-600 hover:text-blue-800 underline">
        {children}
      </a>
    )
  }
  return (
    <ScrollArea className="h-full pb-24">
      <ReactMarkdown components={components}>{readmeContent}</ReactMarkdown>
    </ScrollArea>
  )
}
