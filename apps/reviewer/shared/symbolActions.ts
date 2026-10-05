import { z } from 'zod'
import { DiffSide } from './types'

export const symbolActionRequest = z
  .object({
    side: z.enum(DiffSide),
    path: z.string().min(1).max(2000),
    line: z.number().int().positive().max(1_000_000),
    column: z.number().int().positive().max(1_000_000),
  })
  .strict()
export const symbolActionResponse = z.object({ implementation: z.boolean().nullable() })
