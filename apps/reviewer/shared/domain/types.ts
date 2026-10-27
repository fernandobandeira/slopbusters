import type { PullStatus } from './pullStatus'
import type { PullStackSummary } from './stacks'

export enum Priority {
  high = 'P1',
  normal = 'P2',
  low = 'P3',
}
export enum LineKind {
  context = 'context',
  added = 'added',
  removed = 'removed',
}
export enum DiffSide {
  left = 'LEFT',
  right = 'RIGHT',
}
export enum TransferKind {
  moved = 'moved',
  copied = 'copied',
}
export enum Provider {
  codex = 'codex',
  claude = 'claude',
}
export enum ReviewEvent {
  comment = 'COMMENT',
  requestChanges = 'REQUEST_CHANGES',
  approve = 'APPROVE',
}

export interface DiffLine {
  id: string
  kind: LineKind
  text: string
  oldLine: number | null
  newLine: number | null
}
export interface Hunk {
  /** Canonical sections retain their original patch hunk for legacy progress migration. */
  sourceHunkId?: string
  id: string
  fileId: string
  header: string
  lines: DiffLine[]
}
export interface ChangedFile {
  id: string
  path: string
  previousPath?: string
  status: string
  additions: number
  deletions: number
  hunks: Hunk[]
  coverage: 'complete' | 'partial' | 'unavailable'
  patch?: string
  oldContent?: string
}
export interface ChangeGroup {
  id: string
  title: string
  priority: Priority
  reason: string
  hunkIds: string[]
  fileIds: string[]
}
/** One hunk of edits made inside a moved or copied block, in old/new file coordinates. */
export interface TransferChange {
  header: string
  lines: Pick<DiffLine, 'kind' | 'text' | 'oldLine' | 'newLine'>[]
}
/**
 * A block the PR moved or copied, possibly with small edits. Each end is an inclusive line range
 * in its own revision: the source in the base, the destination in the head.
 */
export interface CodeTransfer {
  id: string
  kind: TransferKind
  fromPath: string
  fromLine: number
  fromEndLine: number
  toPath: string
  toLine: number
  toEndLine: number
  /** Lines in the destination block. */
  lineCount: number
  /** Destination lines that differ from the source, ignoring indentation. 0 when exact. */
  changedLines: number
  /** Source and destination match line for line once indentation is ignored. */
  exact: boolean
  /** The edits inside the block, ignoring indentation; empty when exact. */
  changes: TransferChange[]
  /** Removed patch lines of the source that belong to the block (empty for copies). */
  sourceLineIds: string[]
  /** Added patch lines of the destination that belong to the block, matched or edited. */
  destinationLineIds: string[]
  text: string
}
export interface PullRequest {
  id: string
  url: string
  owner: string
  repo: string
  number: number
  title: string
  description: string
  author: string
  baseBranch: string
  headBranch: string
  baseSha: string
  /** The immutable merge base used by GitHub's PR patch, which can differ from baseSha. */
  mergeBaseSha?: string
  headSha: string
  state: 'open' | 'closed' | 'merged'
  isDraft?: boolean
  files: ChangedFile[]
  groups: ChangeGroup[]
  transfers: CodeTransfer[]
  groupingSource: 'files' | Provider
  warnings: string[]
}
export interface DraftComment {
  id: string
  body: string
  path: string
  line: number
  side: DiffSide
  code?: string
  headSha: string
}
export interface ReviewDraft {
  comments: DraftComment[]
  viewedFileIds: string[]
  viewedHunkIds?: string[]
  summary: string
}
export interface ReviewThreadComment {
  id: string
  author: string
  body: string
  url: string
  createdAt: string
}
export interface ReviewThread {
  id: string
  path: string
  line: number | null
  originalLine: number | null
  side: DiffSide
  resolved: boolean
  outdated: boolean
  canReply: boolean
  comments: ReviewThreadComment[]
}
/** A submitted review's top-level body; GitHub keeps it apart from the inline threads. */
export interface PullReviewBody {
  id: string
  author: string
  state: string
  body: string
  url: string
  submittedAt: string | null
  /** The head commit the review was submitted against. */
  commitId: string | null
}
export interface PullDiscussions {
  headSha: string
  baseSha: string
  threads: ReviewThread[]
}
export interface ToolStatus {
  available: boolean
  detail: string
  authenticated?: boolean
}
export interface GitHubProfile {
  login: string
  avatarUrl: string
  url: string
}
export interface AppStatus {
  github: ToolStatus & { profile?: GitHubProfile }
  codex: ToolStatus
  claude: ToolStatus
}
export interface Repository {
  fullName: string
  description: string
  private: boolean
}
export interface InboxPull {
  status?: PullStatus
  stack?: PullStackSummary
  number: number
  url: string
  title: string
  author: string
  updatedAt: string
  isDraft: boolean
  headSha: string
  labels: string[]
  reviewRequested: boolean
}
export interface RepositoryInbox {
  warnings?: string[]
  viewer: string
  pulls: InboxPull[]
}
