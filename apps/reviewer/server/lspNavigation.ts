import type { NavigationRequest, NavigationResult } from '../shared/navigation'
import type { PullRequest } from '../shared/types'
import { LanguageServers, findExecutable } from './languageServers'
import { startLanguageServer } from './lspClient'
import { createSourceWorkspace, projectRoot, type SourceProject } from './sourceWorkspace'
import type { ReviewWorkspaces } from './reviewWorkspaces'

type Session = Awaited<ReturnType<typeof startLanguageServer>>
interface Entry {
  session: Promise<Session>
  users: number
  timer?: ReturnType<typeof setTimeout>
  closing?: Promise<void>
}

/** Keep at most three idle revision/language sessions; active requests retain their lease. */
export class LanguageServerNavigation {
  private entries = new Map<string, Entry>()
  private closed = false
  constructor(private readonly project: SourceProject, readonly servers: LanguageServers, private readonly workspaces?: Pick<ReviewWorkspaces, 'acquire'>) {}

  private retire(key: string, entry: Entry): Promise<void> {
    clearTimeout(entry.timer)
    if (this.entries.get(key) === entry) this.entries.delete(key)
    entry.closing ??= entry.session.then((session) => session.close(), () => {})
    return entry.closing
  }

  async navigate(pull: PullRequest, request: NavigationRequest): Promise<NavigationResult | undefined> {
    const { language, server } = await this.servers.forPath(request.path)
    if (!server) return undefined
    const fallback = (detail: string): NavigationResult => ({ language, mode: 'text', targets: [], warnings: [detail] })
    if (!server.command) return fallback(`Semantic navigation for ${language} is disabled. Configure its language server in Settings.`)
    const executable = await findExecutable(server.command)
    if (!executable) return fallback(`${server.command} is unavailable. Install it or set its absolute path in Settings to enable semantic navigation for ${language}.`)
    if (this.closed) throw new Error('Source navigation is shutting down.')
    const tree = await this.project.tree(pull, request.side)
    const root = projectRoot(new Set(tree.paths), request.path, language)
    const key = JSON.stringify([pull.owner, pull.repo, tree.sha, root, server, executable])
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        users: 0,
        session: createSourceWorkspace(this.project, pull, request, server, this.workspaces)
          .then((workspace) => startLanguageServer(server, executable, workspace)),
      }
      this.entries.set(key, entry)
    }
    clearTimeout(entry.timer)
    entry.users++
    // Refresh LRU order without disposing a session in use.
    this.entries.delete(key)
    this.entries.set(key, entry)
    try {
      const result = await (await entry.session).navigate(request)
      return { ...result, source: { sha: tree.sha, kind: this.workspaces ? 'local' : 'snapshot' } }
    } catch {
      if (entry.users === 1) await this.retire(key, entry)
      return fallback(`The ${server.command} language server could not resolve this request. Check its installation and project toolchain; retry navigation or use the syntax matches below.`)
    } finally {
      entry.users--
      if (!entry.users && !entry.closing) {
        entry.timer = setTimeout(() => { void this.retire(key, entry) }, 2 * 60_000)
        entry.timer.unref()
      }
      for (const [candidateKey, candidate] of this.entries) {
        if (this.entries.size <= 3) break
        if (!candidate.users) await this.retire(candidateKey, candidate)
      }
    }
  }

  async close() {
    this.closed = true
    await Promise.all([...this.entries].map(([key, entry]) => this.retire(key, entry)))
  }

  async closeRevision(owner: string, repo: string, sha: string, invalidate = false) {
    const matches = [...this.entries].filter(([key]) => {
      const identity = JSON.parse(key) as string[]
      return identity[0] === owner && identity[1] === repo && identity[2] === sha
    })
    if (!invalidate && matches.some(([, entry]) => entry.users)) throw new Error('Source analysis is in progress. Try removing this checkout when it finishes.')
    await Promise.all(matches.map(([key, entry]) => this.retire(key, entry)))
  }
}
