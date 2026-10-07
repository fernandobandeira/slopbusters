export interface IndexEntry {
  mode: string
  sha: string
  stage: string
  path: string
}

export function conflictIndex(output: string) {
  const entries: IndexEntry[] = []
  for (const line of output.split('\0').filter(Boolean)) {
    const match = /^(\d{6}) ([a-f\d]{40,64}) ([0-3])\t(.+)$/s.exec(line)
    if (!match?.[1] || !match[2] || !match[3] || !match[4])
      throw new Error('Invalid Git index entry.')
    entries.push({ mode: match[1], sha: match[2], stage: match[3], path: match[4] })
  }
  const structural = new Map<string, IndexEntry[]>()
  const regular = new Set<string>()
  for (const entry of entries) {
    if (['100644', '100755'].includes(entry.mode)) regular.add(entry.path)
    else if (entry.mode === '120000' && entry.stage !== '0')
      structural.set(
        entry.path,
        entries.filter((candidate) => candidate.path === entry.path),
      )
  }
  for (const entry of entries) {
    if (structural.has(entry.path) || !['100644', '100755'].includes(entry.mode))
      regular.delete(entry.path)
    if (!['100644', '100755', '120000'].includes(entry.mode)) structural.delete(entry.path)
  }
  return { regular, structural, tracked: new Set(entries.map((entry) => entry.path)) }
}
