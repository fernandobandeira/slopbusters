export function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing expected test value.')
  return value
}
