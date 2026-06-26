import { setPanelOpen, useAppDispatch } from '@renderer/redux'
import { BookOpen, Sparkles, X, Zap } from 'lucide-react'
import { AIAssistant } from './AIAssistant'
import { ExamplesContent } from './ExamplesContent'
import { ReadmeContent } from './ReferenceContent'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs'

export function DocsPanel(): React.JSX.Element {
  const dispatch = useAppDispatch()

  const handleCloseDocsPanel = (): void => {
    dispatch(setPanelOpen({ panel: 'docs', isOpen: false }))
  }

  return (
    <div className="size-full flex flex-col bg-[var(--bg-raised)] border-l border-[var(--border-default)]">
      <Tabs defaultValue="readme" className="size-full flex flex-col gap-0">
        <div className="flex items-stretch h-[36px] gap-1 pl-3 pr-1 border-b-[1.5px] border-[var(--border-default)]">
          <TabsList className="flex-1 border-0 gap-1">
            <TabsTrigger value="readme" className="flex-1 justify-center">
              <BookOpen size={15} />
              Docs
            </TabsTrigger>
            <TabsTrigger value="examples" className="flex-1 justify-center">
              <Zap size={15} />
              Examples
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex-1 justify-center">
              <Sparkles size={15} />
              Studio AI
            </TabsTrigger>
          </TabsList>
          <button
            className="shrink-0 self-center flex items-center justify-center size-6 rounded-[var(--radius-xs)] text-[var(--text-faint)] hover:bg-[var(--bg-sunken)] hover:text-[var(--text-strong)]"
            title="Close"
            onClick={handleCloseDocsPanel}
          >
            <X size={15} />
          </button>
        </div>
        <TabsContent value="readme" className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <ReadmeContent />
        </TabsContent>
        <TabsContent value="examples" className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <ExamplesContent />
        </TabsContent>
        <TabsContent value="ai" className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <AIAssistant />
        </TabsContent>
      </Tabs>
    </div>
  )
}
