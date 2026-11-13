import type { LayerFixTools } from '../features/mcp/layerFixTools'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { reviewerIdSchema } from '../../shared/domain/panel'
import { pullUrlSchema } from '../../shared/domain/pullUrl'
import { publicError } from '../errors'
import { DEFAULT_PANEL_WAIT_SECONDS, MAX_PANEL_WAIT_SECONDS } from '../features/mcp/limits'
import type { PanelTools } from '../features/mcp/panelTools'
import type { StackReviewTools } from '../features/mcp/stackReviewTools'

const instructions = `Slopbusters review panels. Reviewers read a GitHub pull request, then two models check every finding against the code and write a plan for each one worth fixing.

Start a panel with start_panel_review once the PR's branch is pushed, then call get_panel_review until it returns the review. A panel takes several minutes and runs on the user's own Claude and Codex accounts, so start one when the user or their instructions ask for a panel review, not on your own.

For a stack of PRs, start_stack_review runs the panel on every layer that needs it and then reads all layers' findings together; get_stack_review returns one brief for the whole stack. It runs a panel per layer, so ask for it only when the user wants the whole stack reviewed.`

const pullRequest = pullUrlSchema.describe(
  'The GitHub pull request URL, such as https://github.com/owner/repo/pull/123.',
)

/** The panel as MCP tools: each tool's name, what it tells the agent, and what it takes. */
export function panelMcpServer(
  tools: PanelTools,
  stack: StackReviewTools,
  fixes?: LayerFixTools,
): McpServer {
  const server = new McpServer({ name: 'slopbusters', version: '1.0.0' }, { instructions })
  for (const register of [listReviewers, startPanelReview, getPanelReview, retryOrCancel])
    register(server, tools)
  for (const register of [startStackReview, getStackReview, retryOrCancelStack])
    register(server, stack)
  if (fixes) {
    server.registerTool(
      'apply_layer_fixes',
      {
        title: 'Apply layer fixes',
        description:
          'Apply all selected layer plans from the newest stack brief. Commits locally in an app-owned worktree and pushes nothing. Returns immediately; use get_layer_fixes to follow progress.',
        inputSchema: { pull_request: pullRequest },
      },
      ({ pull_request }) => answer(() => fixes.apply(pull_request)),
    )
    server.registerTool(
      'get_layer_fixes',
      {
        title: 'Get layer fixes',
        description:
          'Follow the local fix worker and read its observed checks, commits and remaining work. The worker commits locally in an app-owned worktree and pushes nothing.',
        inputSchema: { pull_request: pullRequest, wait_seconds: waitSeconds },
        annotations: { readOnlyHint: true },
      },
      ({ pull_request, wait_seconds }, { signal }) =>
        answer(() => fixes.read(pull_request, wait_seconds ?? DEFAULT_PANEL_WAIT_SECONDS, signal)),
    )
  }
  return server
}

function listReviewers(server: McpServer, tools: PanelTools) {
  server.registerTool(
    'list_reviewers',
    {
      title: 'List panel reviewers',
      description:
        'List who can sit on a review panel: the built-in reviewers and the teammates the user set up, with the ids start_panel_review takes.',
      annotations: { readOnlyHint: true },
    },
    () => answer(() => tools.reviewers()),
  )
}

function startPanelReview(server: McpServer, tools: PanelTools) {
  server.registerTool(
    'start_panel_review',
    {
      title: 'Start a panel review',
      description:
        'Ask the Slopbusters panel to review a GitHub pull request at its pushed head. Returns at once while the panel works; call get_panel_review to wait for the review. Asking again for a PR whose panel is still working with the same reviewers returns that panel.',
      inputSchema: {
        pull_request: pullRequest,
        reviewers: z
          .array(reviewerIdSchema)
          .min(1)
          .max(8)
          .optional()
          .describe(
            'Reviewer ids from list_reviewers. Leave it out for Uncle Bob and the Terminator.',
          ),
      },
    },
    ({ pull_request, reviewers }) => answer(() => tools.start(pull_request, reviewers)),
  )
}

function getPanelReview(server: McpServer, tools: PanelTools) {
  server.registerTool(
    'get_panel_review',
    {
      title: 'Get a panel review',
      description:
        "Read the newest panel review of a pull request. While the panel is working it waits, then returns the review as a brief: the verdict, the fixes worth making with a plan for each, and the findings that were set aside. If the panel is still working when the wait ends, it returns the panel's progress; call it again.",
      inputSchema: {
        pull_request: pullRequest,
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(MAX_PANEL_WAIT_SECONDS)
          .optional()
          .describe(
            `How long to wait for a working panel, ${String(DEFAULT_PANEL_WAIT_SECONDS)} by default. Keep it below your tool-call timeout.`,
          ),
      },
      annotations: { readOnlyHint: true },
    },
    ({ pull_request, wait_seconds }, { signal }) =>
      answer(() => tools.read(pull_request, wait_seconds ?? DEFAULT_PANEL_WAIT_SECONDS, signal)),
  )
}

function retryOrCancel(server: McpServer, tools: PanelTools) {
  server.registerTool(
    'retry_panel_review',
    {
      title: 'Retry a panel review',
      description:
        'Run a panel review that stopped again: one that failed, was cancelled, or is waiting because some reviewers could not finish. Reviews that finished are kept.',
      inputSchema: {
        pull_request: pullRequest,
        skip_failed_reviewers: z
          .boolean()
          .optional()
          .describe(
            'For a panel waiting on reviewers that could not finish: ground the reviews that did finish instead of running the failed reviewers again.',
          ),
      },
    },
    ({ pull_request, skip_failed_reviewers }) =>
      answer(() => tools.retry(pull_request, skip_failed_reviewers ?? false)),
  )
  server.registerTool(
    'cancel_panel_review',
    {
      title: 'Cancel a panel review',
      description:
        'Stop the panel working on a pull request. Reviews that finished stay saved, and retry_panel_review continues from them.',
      inputSchema: { pull_request: pullRequest },
    },
    ({ pull_request }) => answer(() => tools.cancel(pull_request)),
  )
}

const waitSeconds = z
  .number()
  .int()
  .min(0)
  .max(MAX_PANEL_WAIT_SECONDS)
  .optional()
  .describe(
    `How long to wait for a working review, ${String(DEFAULT_PANEL_WAIT_SECONDS)} by default. Keep it below your tool-call timeout.`,
  )

function startStackReview(server: McpServer, tools: StackReviewTools) {
  server.registerTool(
    'start_stack_review',
    {
      title: 'Start a stack review',
      description:
        "Review the whole stack a GitHub pull request belongs to: the panel reviews every open layer whose newest review is missing or was made at another head or base, then two models read all layers' findings together. Returns at once; call get_stack_review to wait for the brief. It runs a panel per layer on the user's own Claude and Codex accounts, so start one only when asked. Asking again while it works returns that review.",
      inputSchema: {
        pull_request: pullRequest.describe('The URL of any pull request in the stack.'),
        reviewers: z
          .array(reviewerIdSchema)
          .min(1)
          .max(8)
          .optional()
          .describe(
            'Reviewer ids from list_reviewers. Leave it out for the reviewers last used on the stack.',
          ),
      },
    },
    ({ pull_request, reviewers }) => answer(() => tools.start(pull_request, reviewers)),
  )
}

function getStackReview(server: McpServer, tools: StackReviewTools) {
  server.registerTool(
    'get_stack_review',
    {
      title: 'Get a stack review',
      description:
        "Read the newest stack review covering a pull request. While it works it waits, then returns the stack brief: the decisions only the author can make, each layer's fixes bottom to top with a plan for each, follow-ups, and stale entries. If it is still working when the wait ends, it returns each layer's progress; call it again.",
      inputSchema: { pull_request: pullRequest, wait_seconds: waitSeconds },
      annotations: { readOnlyHint: true },
    },
    ({ pull_request, wait_seconds }, { signal }) =>
      answer(() => tools.read(pull_request, wait_seconds ?? DEFAULT_PANEL_WAIT_SECONDS, signal)),
  )
}

function retryOrCancelStack(server: McpServer, tools: StackReviewTools) {
  server.registerTool(
    'retry_stack_review',
    {
      title: 'Retry a stack review',
      description:
        'Run a stack review that stopped again: one waiting on a layer whose panel failed or needs the author, one that failed, or one that was cancelled. It reads the stack afresh and keeps every layer whose panel finished at its current head.',
      inputSchema: { pull_request: pullRequest },
    },
    ({ pull_request }) => answer(() => tools.retry(pull_request)),
  )
  server.registerTool(
    'cancel_stack_review',
    {
      title: 'Cancel a stack review',
      description:
        'Stop the stack review working on a pull request’s stack. Panels it already started keep working on their layers; cancel those with cancel_panel_review. retry_stack_review reuses their results.',
      inputSchema: { pull_request: pullRequest },
    },
    ({ pull_request }) => answer(() => tools.cancel(pull_request)),
  )
}

/** A tool's answer as text; a failure is an answer too, with only a message safe to show. */
async function answer(run: () => string | Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: await run() }] }
  } catch (error) {
    const text = publicError(
      error,
      'Slopbusters could not do that. Open the app to see what went wrong.',
    )
    return { content: [{ type: 'text', text }], isError: true }
  }
}
