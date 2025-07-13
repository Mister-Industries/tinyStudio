import React, { useState, useCallback, useMemo } from 'react'
import {
  Folder,
  FolderOpen,
  GitBranch,
  Plus,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  File,
  Image,
  Code,
  Trash2,
  Edit3,
  Download,
  AlertCircle,
  FolderSync,
  Zap
} from 'lucide-react'
import { Button } from './ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'
import { ScrollArea } from './ui/ScrollArea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/DropdownMenu'
import { useFileSystem } from '../lib/useFileSystem'
import { fileSystem, type FileSystemItem } from '../lib/fileSystem'
import { useAppDispatch } from '../redux/hooks'
import { openFile, type EditorFile } from '../redux/fileSlice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './ui/Dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './ui/Form'
import { Input } from './ui/Input'

// File icon mapping
function getFileIcon(fileName: string, isDirectory: boolean, isSelected = false): React.ReactNode {
  if (isDirectory) return null

  if (fileSystem.isImageFile(fileName)) {
    return <Image size={14} className={isSelected ? 'text-accent-foreground' : 'text-blue-500'} />
  }

  if (fileSystem.isCodeFile(fileName)) {
    return <Code size={14} className={isSelected ? 'text-accent-foreground' : 'text-green-500'} />
  }

  return (
    <File size={14} className={isSelected ? 'text-accent-foreground' : 'text-muted-foreground'} />
  )
}

// Tree item component
interface FileTreeItemProps {
  item: FileSystemItem
  level: number
  isExpanded: boolean
  isSelected: boolean
  onToggle: () => void
  onSelect: () => void
  onContextMenu: (item: FileSystemItem) => void
}

function FileTreeItem({
  item,
  level,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onContextMenu
}: FileTreeItemProps): React.JSX.Element {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (item.isDirectory) {
        onToggle()
      } else {
        onSelect()
      }
    },
    [item.isDirectory, onToggle, onSelect]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onContextMenu(item)
    },
    [onContextMenu, item]
  )

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover:bg-accent/50 group ${
        isSelected ? 'bg-accent text-accent-foreground' : ''
      }`}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {item.isDirectory ? (
        <>
          {isExpanded ? (
            <ChevronDown size={14} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground" />
          )}
          {isExpanded ? (
            <FolderOpen size={14} className="text-accent" />
          ) : (
            <Folder size={14} className="text-accent" />
          )}
        </>
      ) : (
        <>
          <span className="w-[14px]" />
          {getFileIcon(item.name, item.isDirectory, isSelected)}
        </>
      )}
      <span className="flex-1 truncate">{item.name}</span>
      {/* // TODO: implement this dropdown to be useful */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-4 opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {item.isDirectory ? (
            <>
              <DropdownMenuItem>
                <Plus size={14} className="mr-2" />
                New File
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Folder size={14} className="mr-2" />
                New Folder
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem>
                <Download size={14} className="mr-2" />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Edit3 size={14} className="mr-2" />
                Rename
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem className="text-destructive">
            <Trash2 size={14} className="mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// File tree component with hierarchical structure
interface FileTreeProps {
  files: FileSystemItem[]
  onFileSelect: (filePath: string) => void
  selectedFile: string | null
  loadDirectory: (dirPath: string) => Promise<FileSystemItem[]>
}

interface TreeNode extends FileSystemItem {
  children?: TreeNode[]
  isLoaded?: boolean
}

function FileTree({
  files,
  onFileSelect,
  selectedFile,
  loadDirectory
}: FileTreeProps): React.JSX.Element {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [loadedDirectories, setLoadedDirectories] = useState<Map<string, FileSystemItem[]>>(
    new Map()
  )

  // Build hierarchical tree structure
  const tree = useMemo(() => {
    const buildTree = (items: FileSystemItem[]): TreeNode[] => {
      const nodes: TreeNode[] = []

      // Sort items: directories first, then files
      const sortedItems = [...items].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })

      for (const item of sortedItems) {
        const node: TreeNode = {
          ...item,
          children: item.isDirectory ? [] : undefined,
          isLoaded: !item.isDirectory || loadedDirectories.has(item.path)
        }

        // If this directory is loaded, add its children
        if (item.isDirectory && loadedDirectories.has(item.path)) {
          const children = loadedDirectories.get(item.path) || []
          node.children = buildTree(children)
        }

        nodes.push(node)
      }

      return nodes
    }

    return buildTree(files)
  }, [files, loadedDirectories])

  const toggleFolder = useCallback(
    async (folderPath: string) => {
      const isExpanded = expandedFolders.has(folderPath)

      if (isExpanded) {
        // Collapse folder
        setExpandedFolders((prev) => {
          const newSet = new Set(prev)
          newSet.delete(folderPath)
          return newSet
        })
      } else {
        // Expand folder
        setExpandedFolders((prev) => new Set(prev).add(folderPath))

        // Load directory contents if not already loaded
        if (!loadedDirectories.has(folderPath)) {
          try {
            const children = await loadDirectory(folderPath)
            setLoadedDirectories((prev) => new Map(prev).set(folderPath, children))
          } catch (error) {
            console.error('Failed to load directory:', error)
          }
        }
      }
    },
    [expandedFolders, loadedDirectories, loadDirectory]
  )

  const isExpanded = useCallback(
    (folderPath: string) => {
      return expandedFolders.has(folderPath)
    },
    [expandedFolders]
  )

  const renderTreeItems = useCallback(
    (nodes: TreeNode[], level = 0): React.ReactNode => {
      return nodes.map((node) => {
        const isSelected = selectedFile === node.path
        const expanded = isExpanded(node.path)

        return (
          <div key={node.path}>
            <FileTreeItem
              item={node}
              level={level}
              isExpanded={expanded}
              isSelected={isSelected}
              onToggle={() => node.isDirectory && toggleFolder(node.path)}
              onSelect={() => !node.isDirectory && onFileSelect(node.path)}
              onContextMenu={(contextItem) => {
                console.log('Context menu for:', contextItem.name)
              }}
            />
            {node.isDirectory && expanded && node.children && (
              <div>{renderTreeItems(node.children, level + 1)}</div>
            )}
          </div>
        )
      })
    },
    [selectedFile, isExpanded, toggleFolder, onFileSelect]
  )

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground py-8 px-4">
        <Folder size={48} className="mb-4 opacity-50" />
        <p className="text-sm mb-4 text-center">No files in workspace</p>
      </div>
    )
  }

  return <div className="py-2">{renderTreeItems(tree)}</div>
}

// Main FileExplorer component
export function FileExplorer(): React.JSX.Element {
  const [openTab, setOpenTab] = useState<'file-explorer' | 'source-control'>('file-explorer')

  return (
    <div className="size-full flex flex-col">
      <div className="flex w-full text-xs font-semibold border-b-2 border-border">
        <div
          data-active={openTab === 'file-explorer'}
          className="flex justify-center items-center gap-2 border-b-2 border-transparent flex-1 px-2 py-4 data-[active=true]:bg-primary-foreground data-[active=true]:text-foreground data-[active=true]:border-primary cursor-pointer"
          onClick={() => setOpenTab('file-explorer')}
        >
          <Folder size={14} />
          File Explorer
        </div>
        <div
          data-active={openTab === 'source-control'}
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

// File explorer content component
export function FileExplorerContent(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const {
    workspace,
    files,
    currentFile,
    isLoading,
    error,
    selectWorkspace,
    openWorkspace,
    refreshFiles,
    createFile,
    setCurrentFile,
    clearError,
    loadDirectory
  } = useFileSystem()

  const handleFileSelect = useCallback(
    async (filePath: string) => {
      try {
        setCurrentFile(filePath)
        const content = await fileSystem.readFile(filePath)

        // Create EditorFile object and dispatch to Redux
        const editorFile: EditorFile = {
          id: filePath,
          name: fileSystem.getFileName(filePath),
          path: filePath,
          content,
          modified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

        dispatch(openFile(editorFile))
      } catch (err) {
        console.error('Failed to open file:', err)
      }
    },
    [setCurrentFile, dispatch]
  )

  const handleNewFile = useCallback(async () => {
    if (!workspace) return

    const fileName = prompt('Enter file name:')
    if (!fileName) return

    try {
      const filePath = fileSystem.joinPath(workspace, fileName)
      await createFile(filePath, '// New file\n')

      // Auto-open the new file
      const editorFile: EditorFile = {
        id: filePath,
        name: fileName,
        path: filePath,
        content: '// New file\n',
        modified: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      dispatch(openFile(editorFile))
      setCurrentFile(filePath)
    } catch (err) {
      console.error('Failed to create file:', err)
    }
  }, [workspace, createFile, dispatch, setCurrentFile])

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center px-4 py-3 text-xs font-semibold border-b border-border">
        <div className="flex items-center gap-2">
          <Folder size={14} />
          {workspace ? workspace.split('/').pop() || workspace : 'WORKSPACE'}
        </div>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-4" onClick={refreshFiles}>
                <FolderSync size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh files</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-4" onClick={handleNewFile}>
                <Plus size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New file</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {error && (
        <div className="mx-4 my-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs flex items-center gap-2">
          <AlertCircle size={14} className="text-destructive" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="icon" className="size-4" onClick={clearError}>
            ×
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1">
        {!workspace ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground py-8 px-4 gap-2">
            <Folder size={48} className="mb-4 opacity-50" />
            <p className="text-sm mb-4 text-center">Open a folder to start working with files</p>
            <Button onClick={selectWorkspace} className="w-40">
              Open Folder
              <FolderOpen size={14} />
            </Button>
            <CreateProjectDialog openWorkspace={openWorkspace} />
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <FileTree
            files={files}
            onFileSelect={handleFileSelect}
            selectedFile={currentFile}
            loadDirectory={loadDirectory}
          />
        )}
      </ScrollArea>
    </div>
  )
}

// Schema for project creation form
const createProjectSchema = z.object({
  projectTitle: z
    .string()
    .min(1, 'Arduino project name is required')
    .min(3, 'Project name must be at least 3 characters')
    .max(50, 'Project name must not exceed 50 characters')
    .regex(
      /^[a-zA-Z0-9\s\-_]+$/,
      'Project name can only contain letters, numbers, spaces, hyphens, and underscores'
    ),
  projectLocation: z
    .string()
    .min(1, 'Project location is required')
    .refine(
      (path) => path.length > 0 && !path.includes('<') && !path.includes('>'),
      'Please select a valid directory path'
    )
})

type CreateProjectFormData = z.infer<typeof createProjectSchema>

const projectPlaceholders = [
  'Long Distance Message Box',
  'fNIRS Headset',
  'Punch-It!',
  'CyberJacket',
  'Smart Graduation Cap'
]

export function CreateProjectDialog({
  openWorkspace
}: {
  openWorkspace: (workspacePath: string) => Promise<void>
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [dialogOpenCount, setDialogOpenCount] = useState(0)

  const form = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      projectTitle: '',
      projectLocation: ''
    }
  })

  // Track when dialog opens to regenerate placeholder
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open)
    if (open) {
      setDialogOpenCount((prev) => prev + 1)
    }
  }, [])

  const handleSelectLocation = useCallback(async () => {
    try {
      // Use the fileSystem API to select a directory
      const selectedPath = await fileSystem.selectFolder()
      if (selectedPath) {
        form.setValue('projectLocation', selectedPath)
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }, [form])

  const handleSubmit = useCallback(
    async (data: CreateProjectFormData) => {
      try {
        console.log('Creating project with data:', data)

        // Create the project directory path
        const projectPath = fileSystem.joinPath(data.projectLocation, data.projectTitle)

        // Check if directory already exists
        const exists = await fileSystem.pathExists(projectPath)
        if (exists) {
          form.setError('projectTitle', {
            type: 'manual',
            message: 'An Arduino project with this name already exists in the selected location'
          })
          return
        }

        // Create the project directory
        await fileSystem.createFolder(projectPath)

        // Create basic Arduino project structure
        const defaultFiles = [
          {
            path: 'README.md',
            content: `# ${data.projectTitle}\n\nAn Arduino project created with TinyStudio.\n\n## Getting Started\n\n1. Open this project in Arduino IDE or TinyStudio\n2. Connect your Arduino board\n3. Upload the sketch to your board\n\n## Hardware Requirements\n\n- Arduino Uno (or compatible board)\n- USB cable\n- Additional components as needed\n\n## Circuit Diagram\n\nAdd your circuit diagram and connections here.\n`
          },
          {
            path: `${data.projectTitle.replace(/\s+/g, '_')}.ino`,
            content: `/*
  ${data.projectTitle}
  
  Created with TinyStudio
  Date: ${new Date().toLocaleDateString()}
  
  Description:
  A basic Arduino sketch template. Customize this code for your project needs.
*/

// Pin definitions
const int LED_PIN = 13;  // Built-in LED pin

void setup() {
  // Initialize serial communication
  Serial.begin(9600);
  
  // Initialize digital pin LED_PIN as an output
  pinMode(LED_PIN, OUTPUT);
  
  Serial.println("${data.projectTitle} - Setup complete!");
}

void loop() {
  // Turn the LED on
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED ON");
  delay(1000);  // Wait for a second
  
  // Turn the LED off
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED OFF");
  delay(1000);  // Wait for a second
}
`
          }
        ]

        // Create default files
        for (const file of defaultFiles) {
          const filePath = fileSystem.joinPath(projectPath, file.path)
          await fileSystem.createFile(filePath, file.content)
        }

        // Close the dialog and reset form
        handleOpenChange(false)
        form.reset()

        console.log('Arduino project created successfully at:', projectPath)

        // Automatically open the created project in the file explorer
        await openWorkspace(projectPath)
      } catch (error) {
        console.error('Failed to create project:', error)
        form.setError('root', {
          type: 'manual',
          message: 'Failed to create project. Please try again.'
        })
      }
    },
    [form, openWorkspace, handleOpenChange]
  )

  // Memoize the random placeholder to prevent it from changing during dialog close animation
  // Only recalculate when dialog is opened (not closed)
  const randomPlaceholder = useMemo(() => {
    return projectPlaceholders[Math.floor(Math.random() * projectPlaceholders.length)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpenCount])

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="w-40">
          Create Project <Zap />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Build Cool Shit</DialogTitle>
          <DialogDescription>
            Just give this project a title and a location and we can handle the rest.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="projectTitle"
              render={({ field }) => (
                <>
                  <FormLabel htmlFor="project-title">Project Title</FormLabel>
                  <FormControl>
                    <Input id="project-title" placeholder={randomPlaceholder} {...field} />
                  </FormControl>
                  <FormMessage />
                </>
              )}
            />
            <FormField
              control={form.control}
              name="projectLocation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="project-location">Project Location</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Input
                        id="project-location"
                        placeholder="Select a location..."
                        readOnly
                        {...field}
                      />
                      <Button type="button" variant="outline" onClick={handleSelectLocation}>
                        Browse
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <div className="text-destructive text-sm">{form.formState.errors.root.message}</div>
            )}
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating...' : 'Create Project'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
