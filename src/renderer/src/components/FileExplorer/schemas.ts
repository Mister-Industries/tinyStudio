/**
 * Validation schemas for FileExplorer forms
 * Contains Zod schemas for form validation
 */

import { z } from 'zod'

// Schema for project creation. Where the project goes is picked with the
// system folder picker when it's created, so only the name is validated here.
export const createProjectSchema = z.object({
  projectTitle: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .min(3, 'Project name must be at least 3 characters')
    .max(50, 'Project name must not exceed 50 characters')
    .regex(
      /^[a-zA-Z0-9\s\-_]+$/,
      'Project name can only contain letters, numbers, spaces, hyphens, and underscores'
    )
})

// Export the inferred type for use in components
export type CreateProjectFormData = z.infer<typeof createProjectSchema>
