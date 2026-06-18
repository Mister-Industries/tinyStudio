import { setPanelOpen, useAppDispatch } from '@renderer/redux'
import { BookOpen, Sparkles, X } from 'lucide-react'
import { AIAssistant } from './AIAssistant'
import { ReadmeContent } from './ReferenceContent'
import { Button } from './ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs'

export function DocsPanel(): React.JSX.Element {
  const dispatch = useAppDispatch()

  const handleCloseDocsPanel = (): void => {
    dispatch(setPanelOpen({ panel: 'docs', isOpen: false }))
  }

  return (
    <div className="size-full flex flex-col bg-navy-700 border-l border-navy-600">
      <Tabs defaultValue="readme" className="size-full flex flex-col gap-0">
        <div className="flex items-center gap-2 px-2 py-2 border-b border-navy-600">
          <TabsList className="bg-navy-900 border border-navy-600 rounded-full p-1 h-auto">
            <TabsTrigger
              value="readme"
              className="rounded-full px-3 py-1 text-xs text-fg-3 data-[state=active]:bg-navy-500 data-[state=active]:text-fg-1"
            >
              <BookOpen size={14} className="mr-1.5" />
              README
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              className="rounded-full px-3 py-1 text-xs text-fg-3 data-[state=active]:bg-navy-500 data-[state=active]:text-fg-1"
            >
              <Sparkles size={14} className="mr-1.5" />
              Studio AI
            </TabsTrigger>
          </TabsList>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="text-fg-3 hover:text-fg-1 hover:bg-navy-500"
            onClick={handleCloseDocsPanel}
          >
            <X />
          </Button>
        </div>
        <TabsContent value="readme" className="flex-1 min-h-0 px-4 py-3 overflow-hidden">
          <ReadmeContent />
        </TabsContent>
        <TabsContent value="ai" className="flex-1 min-h-0 overflow-hidden">
          <AIAssistant />
        </TabsContent>
      </Tabs>
    </div>
  )
}
