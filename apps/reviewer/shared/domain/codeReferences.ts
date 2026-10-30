/** A place in the code a reviewer names in prose, such as `senders/sms-sender.ts:106–113`. */
export interface CodeReference {
  /** As written: a whole path from the repository root, or its last few segments. */
  path: string
  line?: number
  endLine?: number
}

const pathPattern = String.raw`([\w@.\-+/]*[\w@\-+]\.[A-Za-z0-9]+|[\w@.\-+]+(?:/[\w@.\-+]+)+)`
const reference = new RegExp(
  String.raw`^\.?/?${pathPattern}(?:(?::|#L)(\d+)(?::\d+)?(?:\s*[-–—]\s*L?(\d+))?)?$`,
)

/**
 * The code reference an inline code span names, or nothing. A bare file name counts only with a
 * line, so `app.prisma` or `user.name` in prose stays text, while `a.ts:12` and `src/a.ts` open.
 */
export function parseCodeReference(text: string): CodeReference | undefined {
  const match = reference.exec(text.trim())
  if (!match) return undefined
  const [, path = '', start, end] = match
  const line = start ? Number(start) : undefined
  if (!line && !path.includes('/')) return undefined
  if (path.startsWith('http') || path.includes('//')) return undefined
  const endLine = end && line && Number(end) >= line ? Number(end) : undefined
  return { path, ...(line ? { line } : {}), ...(endLine ? { endLine } : {}) }
}

/** The repository paths a reference can mean: the path itself, else those ending with it. */
export function matchingPaths(paths: readonly string[], path: string): string[] {
  const wanted = path.replace(/^\.?\//, '')
  if (paths.includes(wanted)) return [wanted]
  return paths.filter((candidate) => candidate.endsWith(`/${wanted}`))
}
