import { sourceIdentitySchema } from '../domain/sourceIdentity'
import { z } from 'zod'
import { preferencesSchema } from '../domain/preferences'
import { languageExtensions } from '../domain/languages'
import { defineRoute, okSchema } from './contract'
import { workspaceInfo } from './source'

export const languageServerConfigurationSchema = z
  .array(
    z
      .object({
        language: z
          .string()
          .regex(/^[a-z][a-z0-9_+-]*$/)
          .max(80),
        extensions: z
          .array(
            z
              .string()
              .regex(/^[a-z0-9]+$/)
              .max(30),
          )
          .min(1)
          .max(30),
        command: z
          .string()
          .max(2000)
          .refine((value) => !/[\r\n\0]/.test(value)),
        args: z
          .array(
            z
              .string()
              .max(4000)
              .refine((value) => !value.includes('\0')),
          )
          .max(50),
      })
      .strict(),
  )
  .max(60)
  .superRefine((servers, context) => {
    const languages = new Set<string>()
    const extensions = new Set<string>()
    for (const server of servers) {
      if (['typescript', 'javascript'].includes(server.language) || languages.has(server.language))
        context.addIssue({
          code: 'custom',
          message: 'Language IDs must be unique; JavaScript and TypeScript are bundled.',
        })
      languages.add(server.language)
      for (const extension of server.extensions) {
        if (
          extensions.has(extension) ||
          [...languageExtensions.typescript, ...languageExtensions.javascript].includes(extension)
        )
          context.addIssue({ code: 'custom', message: 'Each extension must belong to one server.' })
        extensions.add(extension)
      }
    }
  })
const servers = z.array(
  z.object({
    language: z.string(),
    extensions: z.array(z.string()),
    command: z.string(),
    args: z.array(z.string()),
    available: z.boolean(),
    detail: z.string(),
  }),
)
export const getPreferences = defineRoute('GET', '/preferences', { response: preferencesSchema })
export const savePreferences = defineRoute('PUT', '/preferences', {
  request: preferencesSchema,
  response: preferencesSchema,
})
export const getLanguageServers = defineRoute('GET', '/language-servers', { response: servers })
export const saveLanguageServers = defineRoute('PUT', '/language-servers', {
  request: languageServerConfigurationSchema,
  response: servers,
})
export const getWorkspaces = defineRoute('GET', '/workspaces', {
  response: z.array(workspaceInfo.extend({ owner: z.string(), repo: z.string() })),
})
export const removeWorkspace = defineRoute('DELETE', '/workspaces', {
  request: sourceIdentitySchema,
  response: okSchema,
})
