import { z } from 'zod'
const repositoryName = z
  .string()
  .max(100)
  .regex(/^[\w.-]+$/)
  .refine((value) => value !== '.' && value !== '..')
export const sourceIdentitySchema = z
  .object({
    owner: repositoryName,
    repo: repositoryName,
    sha: z.string().regex(/^[a-f\d]{40}(?:[a-f\d]{24})?$/i),
  })
  .strict()
