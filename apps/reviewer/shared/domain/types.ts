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
export interface CodeTransfer {
  id: string
  kind: TransferKind
  fromPath: string
  fromLine: number
  toPath: string
  toLine: number
  lineCount: number
  destinationLineIds: string[]
  sourceLineIds: string[]
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
