import type { Request, Response, Router } from 'express'
import { z } from 'zod'
import { UserError } from '../errors'
import type { ApiContract, RouteInput } from '../../shared/api/contract'

export function handle<C extends ApiContract>(
  router: Router,
  contract: C,
  handler: (
    input: RouteInput<C>,
    request: Request,
    response: Response,
  ) => z.output<C['response']> | Promise<z.output<C['response']>>,
) {
  router[contract.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](
    contract.path,
    async (request, response) => {
      const input = requestInput(contract, request)
      const result = await handler(input, request, response)
      const validated = contract.response.safeParse(result)
      if (!validated.success)
        throw new Error(`Invalid response for ${contract.method} ${contract.path}`, {
          cause: validated.error,
        })
      response.json(validated.data)
    },
  )
}

function requestInput<C extends ApiContract>(contract: C, request: Request): RouteInput<C> {
  try {
    return {
      params: contract.params.parse(request.params),
      query: contract.query.parse(request.query),
      body: contract.request.parse(request.body),
    } as RouteInput<C>
  } catch (error) {
    if (error instanceof z.ZodError) throw new UserError('The request contained invalid data.')
    throw error
  }
}
