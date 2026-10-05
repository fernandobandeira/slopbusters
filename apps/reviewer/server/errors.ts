export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'UserError'
  }
}

export function logError(context: string, error: unknown) {
  console.error(`[reviewer] ${context}`, error)
}

export function publicError(error: unknown, fallback = 'Something went wrong. Please retry.') {
  if (error instanceof UserError) return error.message
  logError(fallback, error)
  return fallback
}
