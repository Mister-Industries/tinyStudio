/**
 * CreateProjectDialog Component
 * Modal dialog for creating new Arduino projects with validation
 */

import React, { useState, useCallback, useMemo } from 'react'
import { Zap } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../ui/Dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../ui/Form'
import { Input } from '../ui/Input'
import { CreateProjectDialogProps } from './types'
import { createProjectSchema, CreateProjectFormData } from './schemas'
import { createDefaultProjectFiles, getRandomProjectPlaceholder } from './utils'
import { fileSystem } from '../../lib/fileSystem'

export function CreateProjectDialog({
  openWorkspace
}: CreateProjectDialogProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [dialogOpenCount, setDialogOpenCount] = useState(0)

  // Initialize form with validation
  const form = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      projectTitle: '',
      projectLocation: ''
    }
  })

  /**
   * Track when dialog opens to regenerate placeholder
   */
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open)
    if (open) {
      setDialogOpenCount((prev) => prev + 1)
    }
  }, [])

  /**
   * Handle folder selection for project location
   */
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

  /**
   * Handle form submission and project creation
   */
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
            message: 'A tinyForge project with this name already exists in the selected location'
          })
          return
        }

        // Create the project directory
        await fileSystem.createFolder(projectPath)

        // Create basic Arduino project structure
        const defaultFiles = createDefaultProjectFiles(data.projectTitle)

        // Create default files
        for (const file of defaultFiles) {
          const filePath = fileSystem.joinPath(projectPath, file.path)
          await fileSystem.createFile(filePath, file.content)
        }

        // Close the dialog and reset form
        handleOpenChange(false)
        form.reset()

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

  /**
   * Generate random placeholder that changes when dialog opens
   */
  const randomPlaceholder = useMemo(() => {
    return getRandomProjectPlaceholder()
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
            {/* Project Title Field */}
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
            {/* Project Location Field */}
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
            {/* Root Error Display */}
            {form.formState.errors.root && (
              <div className="text-destructive text-sm">{form.formState.errors.root.message}</div>
            )}
            {/* Action Buttons */}
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
