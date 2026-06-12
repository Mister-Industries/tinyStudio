import { Lightbulb, X } from 'lucide-react'
import { ReadmeContent } from './ReferenceContent'
import { Button } from './ui/Button'
import { setPanelOpen, useAppDispatch } from '@renderer/redux'

export function DocsPanel(): React.JSX.Element {
  const dispatch = useAppDispatch()

  const handleCloseDocsPanel = (): void => {
    dispatch(setPanelOpen({ panel: 'docs', isOpen: false }))
  }
  return (
    <div className="size-full flex flex-col bg-navy-700 border-l border-navy-600">
      <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b border-navy-600 justify-between">
        <div className="flex items-center gap-2 text-fg-1">
          <Lightbulb size={16} className="text-cyan" />
          Help and documentation
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-fg-3 hover:text-fg-1 hover:bg-navy-500"
          onClick={handleCloseDocsPanel}
        >
          <X />
        </Button>
      </div>
      <div className="flex w-full h-full justify-center px-4 py-2">
        {/* <Tabs defaultValue="examples" className="w-min-[400px] w-full">
          <TabsList className="flex justify-center w-full px-2">
            <TabsTrigger value="reference">
              <CodeXml />
              README
            </TabsTrigger>
            <TabsTrigger value="ai">
              <MessageCircle />
              AI Chat
            </TabsTrigger>
            <TabsTrigger value="examples">
              <BookOpen />
              Examples
            </TabsTrigger>
          </TabsList>
          <TabsContent className="h-full" value="reference">
            <ReadmeContent />
          </TabsContent>
          <TabsContent className="h-full" value="ai">
            <AIAssistant />
          </TabsContent>
          <TabsContent className="h-full" value="examples">
            <ExamplesContent />
          </TabsContent>
        </Tabs> */}
        <ReadmeContent />
      </div>
    </div>
  )
}
