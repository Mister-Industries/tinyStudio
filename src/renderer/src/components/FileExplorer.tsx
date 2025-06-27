import { Folder, GitBranch, Plus, FileText } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/Accordion'
import { ScrollArea } from './ui/ScrollArea'

const projects = [
  {
    name: 'Project Alpha',
    files: ['index.tsx', 'App.tsx', 'styles.css']
  },
  {
    name: 'Project Beta',
    files: ['main.py', 'requirements.txt']
  }
]

export function FileExplorer(): React.JSX.Element {
  const [openTab, setOpenTab] = useState<'file-explorer' | 'source-control'>('file-explorer')

  // TODO: Implement better logic for the tabs
  return (
    <div className="size-full flex flex-col">
      <div className="flex w-full text-xs font-semibold border-b-2 border-border">
        <div
          data-active={openTab == 'file-explorer'}
          className="flex justify-center items-center gap-2 border-b-2 border-transparent flex-1 px-2 py-4 data-[active=true]:bg-primary-foreground data-[active=true]:text-foreground data-[active=true]:border-primary cursor-pointer"
          onClick={() => setOpenTab('file-explorer')}
        >
          <Folder size={14} />
          File Explorer
        </div>
        <div
          data-active={openTab == 'source-control'}
          className="flex justify-center items-center gap-2 border-b-2 border-transparent flex-1 px-2 py-4 data-[active=true]:bg-primary-foreground data-[active=true]:text-foreground data-[active=true]:border-primary cursor-pointer"
          onClick={() => setOpenTab('source-control')}
        >
          <GitBranch size={14} />
          Source Control
        </div>
      </div>
      {openTab === 'file-explorer' && <FileExplorerContent />}
      {openTab === 'source-control' && (
        <div className="px-4 flex-1 flex justify-center text-muted-foreground">
          Source Control is under construction
        </div>
      )}
    </div>
  )
}

export function FileExplorerContent(): React.JSX.Element {
  return (
    <div className="h-full">
      <div className="flex justify-between items-center px-4 py-3 text-xs font-semibold border-b border-border">
        <div className="flex items-center gap-2">
          <Folder size={14} />
          PROJECTS
        </div>
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon" className="size-4">
              <Plus size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create a new project</TooltipContent>
        </Tooltip>
      </div>
      <ScrollArea className="h-full">
        <Accordion type="multiple">
          {projects.map((project, idx) => (
            <AccordionItem value={`project-${idx}`} key={project.name} className="px-4 group">
              <AccordionTrigger>
                <div className="flex gap-2 text-xs">
                  <Folder size={14} className="text-secondary group-hover:text-foreground" />
                  {project.name}
                </div>
              </AccordionTrigger>
              <AccordionContent className="flex flex-col">
                {project.files.map((file) => (
                  <Button key={file} variant="ghost" className="ml-4 text-xs justify-start">
                    <FileText className="size-3 p-0" />
                    {file}
                  </Button>
                ))}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </ScrollArea>
    </div>
  )
}
