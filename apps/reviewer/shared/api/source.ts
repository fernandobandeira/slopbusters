import { z } from 'zod'
import { DiffSide } from '../domain/types'
import type { NavigationResult } from '../domain/navigation'
import type { RevisionFileContent } from '../domain/fileContent'
import { defineRoute, idParams } from './contract'

const sideQuery = z.object({ side: z.enum(DiffSide) })
export const getSymbolActions = defineRoute('POST', '/pulls/:id/symbol-actions', {
  params: idParams,
  request: sideQuery
    .extend({
      path: z.string().min(1).max(2000),
      line: z.number().int().positive().max(1_000_000),
      column: z.number().int().positive().max(1_000_000),
    })
    .strict(),
  response: z.object({ implementation: z.boolean().nullable() }),
})
const sourceFile = z.object({
  path: z.string(),
  sha: z.string(),
  content: z.string(),
  symbols: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['class', 'function', 'method']),
      line: z.number(),
      endLine: z.number(),
    }),
  ),
}) satisfies z.ZodType<RevisionFileContent>
export const workspaceInfo = z.object({
  sha: z.string(),
  status: z.enum(['preparing', 'ready', 'failed', 'absent']),
  directory: z.string().optional(),
  error: z.string().optional(),
  warnings: z.array(z.string()),
})
export const getFileContent = defineRoute('GET', '/pulls/:id/files/:fileId/content', {
  params: idParams.extend({ fileId: z.string().min(1).max(100) }),
  response: z.object({
    fileId: z.string(),
    old: sourceFile.nullable(),
    new: sourceFile.nullable(),
  }),
})
export const getSourceTree = defineRoute('GET', '/pulls/:id/source-tree', {
  params: idParams,
  query: sideQuery,
  response: z.object({
    sha: z.string(),
    paths: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
})
export const getSourceFile = defineRoute('GET', '/pulls/:id/source-file', {
  params: idParams,
  query: sideQuery.extend({ path: z.string().min(1).max(2000) }),
  response: sourceFile,
})
export const getWorkspace = defineRoute('GET', '/pulls/:id/workspace', {
  params: idParams,
  query: sideQuery,
  response: workspaceInfo,
})
export const prepareWorkspace = defineRoute('POST', '/pulls/:id/workspace', {
  params: idParams,
  request: sideQuery.strict(),
  response: workspaceInfo,
})
const navigationResult = z.object({
  language: z.string(),
  mode: z.enum(['semantic', 'text']),
  targets: z.array(
    z.object({
      path: z.string(),
      line: z.number(),
      column: z.number(),
      endLine: z.number(),
      endColumn: z.number(),
      name: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
  source: z.object({ sha: z.string(), kind: z.enum(['local', 'snapshot']) }).optional(),
}) satisfies z.ZodType<NavigationResult>
export const navigateSource = defineRoute('POST', '/pulls/:id/navigation', {
  params: idParams,
  request: z
    .object({
      side: z.enum(DiffSide),
      path: z.string().min(1).max(2000),
      line: z.number().int().positive().max(1_000_000),
      column: z.number().int().positive().max(1_000_000),
      kind: z.enum(['definition', 'references', 'implementation']),
    })
    .strict(),
  response: navigationResult,
})
