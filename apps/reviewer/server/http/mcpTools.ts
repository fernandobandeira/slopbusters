import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { reviewerIdSchema } from '../../shared/domain/panel'
import { pullUrlSchema } from '../../shared/domain/pullUrl'
import { publicError } from '../errors'
import { DEFAULT_PANEL_WAIT_SECONDS, MAX_PANEL_WAIT_SECONDS } from '../features/mcp/limits'
import type { PanelTools } from '../features/mcp/panelTools'

const instructions = `Slopbusters review panels. Reviewers read a GitHub pull request, then two models check every finding against the code and write a plan for each one worth fixing.

Start a panel with start_panel_review once the PR's branch is pushed, then call get_panel_review until it returns the review. A panel takes several minutes and runs on the user's own Claude and Codex accounts, so start one when the user or their instructions ask for a panel review, not on your own.`

const pullRequest = pullUrlSchema.describe(
  'The GitHub pull request URL, such as https://github.com/owner/repo/pull/123.',
)

/** The panel as MCP tools: each tool's name, what it tells the agent, and what it takes. */
export function panelMcpServer(tools: PanelTools): McpServer {
  const server = new McpServer({ name: 'slopbusters', version: '1.0.0' }, { instructions })
  for (const register of [listReviewers, startPanelReview, getPanelReview, retryOrCancel])
    register(server, tools)
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
