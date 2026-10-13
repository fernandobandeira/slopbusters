import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../../server/adapters/t3Engine/engineTurns'

/**
 * Structured turns that record every request and reply with `reply`, validated by the
 * request's schema as the engine runner does. Without `reply`, any turn fails the test.
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
      return request.schema.parse(reply(request))
    },
  }
  return { turns, requests }
}
