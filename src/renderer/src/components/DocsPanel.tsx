import { BookOpen, CodeXml, Lightbulb, MessageCircle, X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs'
import { AIAssistant } from './AIAssistant'
import { ExamplesContent } from './ExamplesContent'
import { ReferenceContent } from './ReferenceContent'
import { Button } from './ui/Button'
import { setPanelOpen, useAppDispatch } from '@renderer/redux'

export function DocsPanel(): React.JSX.Element {
  const dispatch = useAppDispatch()

  const handleCloseDocsPanel = (): void => {
    dispatch(setPanelOpen({ panel: 'docs', isOpen: false }))
  }
  return (
    <div className="size-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-muted text-xs font-semibold border-b border-border justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} />
          Help and Documentation
        </div>
        <Button variant="ghost" size="icon" onClick={handleCloseDocsPanel}>
          <X />
        </Button>
      </div>
      <div className="flex w-full h-full justify-center px-4 py-2">
        <Tabs defaultValue="ai" className="w-min-[400px] w-full">
          <TabsList className="flex justify-center w-full px-2">
            <TabsTrigger value="ai">
              <MessageCircle />
              AI Chat
            </TabsTrigger>
            <TabsTrigger value="examples">
              <BookOpen />
              Examples
            </TabsTrigger>
            <TabsTrigger value="reference">
              <CodeXml />
              Reference
            </TabsTrigger>
          </TabsList>
          <TabsContent className="h-full" value="ai">
            <AIAssistant />
          </TabsContent>
          <TabsContent className="h-full" value="examples">
            <ExamplesContent />
          </TabsContent>
          <TabsContent className="h-full" value="reference">
            <ReferenceContent />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
