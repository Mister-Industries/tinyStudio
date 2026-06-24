import { useAppSelector } from '@renderer/redux'
import { Folder } from 'lucide-react'
import { Markdown } from './Markdown'

export function ReadmeContent(): React.JSX.Element {
  const readmeContent = useAppSelector((state) => state.file.readmeContent)
  if (readmeContent === null || readmeContent === '' || readmeContent === undefined) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-center text-fg-3 px-6">
        <Folder size={40} className="opacity-40" />
        <p className="text-sm">Open a project to view its documentation</p>
      </div>
    )
  }
  return (
    <div className="h-full w-full min-w-0 overflow-y-auto overflow-x-hidden px-4 py-3 pb-10">
      <Markdown className="min-w-0 max-w-full break-words">{readmeContent}</Markdown>
    </div>
  )
}
