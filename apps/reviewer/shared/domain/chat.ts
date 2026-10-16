import { z } from 'zod'
import { seatIdSchema } from './panel'
import { pullUrlSchema as pullUrl } from './pullUrl'

/** Where a chat runs: the user's T3 Code, or the T3 Code engine Slopbusters bundles. */
export type ChatLocation = 't3code' | 'slopbusters'

const sessionId = z.string().min(1).max(100)

/**
 * The review a T3 Code conversation picks up from. Linus, Gandalf and panel sessions cover several
 * PRs, so they also name the PR; a panel chat continues one of its reviewers.
 */
export const continueChatSchema = z.discriminatedUnion('persona', [
  z.object({ persona: z.literal('linus'), sessionId, url: pullUrl }).strict(),
  z.object({ persona: z.literal('unclebob'), sessionId }).strict(),
  z.object({ persona: z.literal('jobs'), sessionId }).strict(),
  z.object({ persona: z.literal('gandalf'), sessionId, url: pullUrl }).strict(),
  z
    .object({ persona: z.literal('panel'), sessionId, url: pullUrl, reviewer: seatIdSchema })
    .strict(),
])
export type ContinueChatRequest = z.infer<typeof continueChatSchema>

/** A conversation with a persona, running as a T3 Code thread. */
export interface Chat {
  threadId: string
  title: string
  /** The T3 Code project whose checkout the thread works in. */
  project: string
  location: ChatLocation
  /** False when a reused PR worktree kept local commits or changes and is not at the PR head. */
  onPullRequestHead?: boolean
}

export const chatSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  project: z.string(),
  location: z.enum(['t3code', 'slopbusters']),
  onPullRequestHead: z.boolean().optional(),
}) satisfies z.ZodType<Chat>
