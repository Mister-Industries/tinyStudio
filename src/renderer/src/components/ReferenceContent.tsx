import { useAppSelector } from '@renderer/redux'
import { Markdown } from './Markdown'
import { NoProjectMessage, PanelMessage } from './NoProjectMessage'

export function ReadmeContent(): React.JSX.Element {
  const hasWorkspace = useAppSelector((state) => state.file.workspace !== null)
  const readmeContent = useAppSelector((state) => state.file.readmeContent)
  if (!hasWorkspace) return <NoProjectMessage action="read the docs" />
  if (readmeContent === null || readmeContent === '' || readmeContent === undefined) {
    return <PanelMessage>This project has no README</PanelMessage>
  }
  return (
    <div className="h-full w-full min-w-0 overflow-y-auto overflow-x-hidden px-4 py-3 pb-10">
      <Markdown className="min-w-0 max-w-full break-words">{readmeContent}</Markdown>
    </div>
  )
}
