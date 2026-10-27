import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../../server/adapters/t3Engine/engineTurns'

/**
 * Structured turns that record every request and reply with `reply`, validated by the
 * request's schema as the engine runner does, and settled once on the request's directory as
 * if it were the agent's copy. Without `reply`, any turn fails the test.
 */
export function recordingTurns(
  reply: (request: StructuredTurnRequest<unknown>) => unknown = () => {
    throw new Error('No agent turn was expected.')
  },
) {
  const requests: StructuredTurnRequest<unknown>[] = []
  const turns: StructuredTurns = {
    run: async <T>(request: StructuredTurnRequest<T>) => {
      requests.push(request)
      await Promise.resolve()
      const parsed = request.schema.parse(reply(request))
      await request.copy?.settle?.(request.directory ?? '', parsed)
      return parsed
    },
  }
  return { turns, requests }
}
