import { z } from 'zod'
import { gandalfTaskSchema } from './gandalf'

/** Where a chat runs: the user's T3 Code, or the T3 Code engine Slopbusters bundles. */
export type ChatLocation = 't3code' | 'slopbusters'

/** Who to talk to about a pull request, and for Gandalf, what to fix. */
export const pullChatSchema = z.discriminatedUnion('persona', [
  z.object({ persona: z.literal('linus') }).strict(),
  z.object({ persona: z.literal('unclebob') }).strict(),
  z.object({ persona: z.literal('gandalf'), task: gandalfTaskSchema }).strict(),
])
export type PullChatRequest = z.infer<typeof pullChatSchema>

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
