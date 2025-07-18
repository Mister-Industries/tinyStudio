import { useAppSelector } from '@renderer/redux'

export function ReadmeContent(): React.JSX.Element {
  const readmeContent = useAppSelector((state) => state.file.readmeContent)
  return <div>{readmeContent}</div>
}
