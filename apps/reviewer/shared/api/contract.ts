import { z } from 'zod'
import { parsePullUrl } from '../domain/pullUrl'

export function defineRoute<
  R extends z.ZodType,
  P extends z.ZodType = z.ZodObject<Record<never, never>>,
  Q extends z.ZodType = z.ZodObject<Record<never, never>>,
  B extends z.ZodType = z.ZodUndefined,
>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  schemas: { response: R; params?: P; query?: Q; request?: B },
) {
  return {
    method,
    path,
    params: (schemas.params ?? z.object({}).strict()) as P,
    query: (schemas.query ?? z.object({}).strict()) as Q,
    request: (schemas.request ?? z.undefined()) as B,
    response: schemas.response,
  }
}

export type ApiContract = ReturnType<typeof defineRoute<z.ZodType, z.ZodType, z.ZodType, z.ZodType>>
type Field<K extends string, T> =
  T extends Record<string, never> ? { [Key in K]?: T } : { [Key in K]: T }
export type CallInput<C extends ApiContract> = Field<'params', z.input<C['params']>> &
  Field<'query', z.input<C['query']>> &
  (undefined extends z.input<C['request']>
    ? { body?: z.input<C['request']> }
    : { body: z.input<C['request']> })
export type RouteInput<C extends ApiContract> = {
  params: z.output<C['params']>
  query: z.output<C['query']>
  body: z.output<C['request']>
}

export function routeUrl(contract: ApiContract, input: { params?: unknown; query?: unknown }) {
  const params = contract.params.parse(input.params ?? {}) as Record<string, string>
  const query = contract.query.parse(input.query ?? {}) as Record<string, unknown>
  const path = contract.path.replace(/:([\w]+)/g, (_, name: string) =>
    encodeURIComponent(params[name]!),
  )
  const search = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
  return `/api${path}${search.size ? `?${search}` : ''}`
}

export const idParams = z.object({ id: z.string().min(1).max(100) })
export const repositoryQuery = z.object({
  repository: z
    .string()
    .max(300)
    .regex(/^[\w.-]+\/[\w.-]+$/),
})
export const pullUrlSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((url) => {
    try {
      parsePullUrl(url)
      return true
    } catch {
      return false
    }
  }, 'Enter a valid GitHub pull request URL.')
export const urlQuery = z.object({ url: pullUrlSchema })
export const okSchema = z.object({ ok: z.literal(true) })
