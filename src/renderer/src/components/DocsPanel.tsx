import {
  selectDocsTab,
  setDocsTab,
  setPanelOpen,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'
import type { DocsTab } from '@renderer/redux/editorSlice'
import { BookOpen, Sparkles, X, Zap } from 'lucide-react'
import { AIAssistant } from './AIAssistant'
import { ExamplesContent } from './ExamplesContent'
import { ReadmeContent } from './ReferenceContent'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs'

// Per-tab accent color, overriding the shared TabsTrigger's brand-blue
// underline/active-state. Docs is left alone (brand blue is already the
// intended scheme); Examples gets yellow; Studio AI gets a light grape purple.
const examplesAccent =
  'after:bg-[var(--yellow)] hover:text-[var(--yellow-deep)] data-[state=active]:text-[var(--yellow-deep)] focus-visible:text-[var(--yellow-deep)]'
const aiAccent =
  'after:bg-[#9c6c9c] hover:text-[#9c6c9c] data-[state=active]:text-[#9c6c9c] focus-visible:text-[#9c6c9c]'

export function DocsPanel(): React.JSX.Element {
  const dispatch = useAppDispatch()
  // Controlled: starts on 'examples' (see editorSlice initialState) and
  // activateWorkspace() flips it to 'readme' whenever a folder or example
  // is opened. The user can still switch freely afterward.
  const activeTab = useAppSelector(selectDocsTab)

  const handleCloseDocsPanel = (): void => {
    dispatch(setPanelOpen({ panel: 'docs', isOpen: false }))
  }

  return (
    <div className="size-full flex flex-col bg-[var(--bg-raised)] border-l border-[var(--border-default)]">
      <Tabs
        value={activeTab}
        onValueChange={(v) => dispatch(setDocsTab(v as DocsTab))}
        className="size-full flex flex-col gap-0"
      >
        <div className="flex items-stretch h-[36px] gap-1 pl-3 pr-1 border-b-[1.5px] border-[var(--border-default)]">
          <TabsList className="flex-1 border-0 gap-1">
            <TabsTrigger value="readme" className="flex-1 justify-center">
              <BookOpen size={15} />
              Docs
            </TabsTrigger>
            <TabsTrigger value="examples" className={`flex-1 justify-center ${examplesAccent}`}>
              <Zap size={15} />
              Examples
            </TabsTrigger>
            <TabsTrigger value="ai" className={`flex-1 justify-center ${aiAccent}`}>
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
