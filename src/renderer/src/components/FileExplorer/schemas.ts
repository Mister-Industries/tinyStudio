/**
 * Validation schemas for FileExplorer forms
 * Contains Zod schemas for form validation
 */

import { z } from 'zod'

// Schema for project creation form
export const createProjectSchema = z.object({
  projectTitle: z
    .string()
    .min(1, 'Project name is required')
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

// Export the inferred type for use in components
export type CreateProjectFormData = z.infer<typeof createProjectSchema>
