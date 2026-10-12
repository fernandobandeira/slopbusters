import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { expect, it, vi } from 'vitest'
import {
  ClientOrchestrationCommand,
  GitPreparePullRequestThreadInput,
  type OrchestrationShellStreamItem,
} from '@t3tools/contracts'
import type { EngineClient } from '../server/adapters/t3Engine/engineConnection'
import type { RunningEngine } from '../server/adapters/t3Engine/engineLocation'
import { EngineThreads } from '../server/adapters/t3Engine/engineThreads'

const engine: RunningEngine = {
  home: '/home/user/.t3',
  origin: 'http://127.0.0.1:3773',
  environmentId: 'environment-1',
  serverVersion: '0.0.45',
}
const url = 'https://github.com/Example/Project/pull/42'

/** Runs each engine operation against a client that implements only the methods under test. */
function connectionTo(methods: Partial<Record<keyof EngineClient, unknown>>) {
  return {
    run: <A, E>(
      operation: (client: EngineClient, engine: RunningEngine) => Effect.Effect<A, E>,
    ): Promise<A> => Effect.runPromise(Effect.orDie(operation(methods as EngineClient, engine))),
  }
}

it('lists projects from the first shell snapshot with lowercase repository keys', async () => {
  const snapshot = {
    kind: 'snapshot',
    snapshot: {
      projects: [
        {
          id: 'project-1',
          title: 'project',
          workspaceRoot: '/code/project',
          repositoryIdentity: { canonicalKey: 'github.com/Example/Project' },
        },
        { id: 'scratch', title: 'Scratch', workspaceRoot: '/scratch', repositoryIdentity: null },
      ],
    },
  } as unknown as OrchestrationShellStreamItem
  const synchronized = { kind: 'synchronized' } as OrchestrationShellStreamItem
  const threads = new EngineThreads(
    connectionTo({ 'orchestration.subscribeShell': () => Stream.make(synchronized, snapshot) }),
  )

  const projects = await threads.projects()

  expect(projects).toEqual([
    {
      id: 'project-1',
      title: 'project',
      workspaceRoot: '/code/project',
      repository: 'github.com/example/project',
    },
    { id: 'scratch', title: 'Scratch', workspaceRoot: '/scratch' },
  ])
})

it('prepares the PR in a worktree with a payload the engine contract accepts', async () => {
  const prepare = vi.fn((_input: unknown) =>
    Effect.succeed({ branch: 'feature', worktreePath: '/worktree', isOnPullRequestHead: true }),
  )
  const threads = new EngineThreads(connectionTo({ 'git.preparePullRequestThread': prepare }))

  const prepared = await threads.preparePullRequest({
    cwd: '/code/project',
    url,
    threadId: 'thread-1',
  })

  expect(prepared).toEqual({
    branch: 'feature',
    worktreePath: '/worktree',
    onPullRequestHead: true,
  })
  const input = prepare.mock.calls[0]?.[0]
  expect(Schema.encodeUnknownSync(GitPreparePullRequestThreadInput)(input)).toEqual({
    cwd: '/code/project',
    reference: url,
    mode: 'worktree',
    threadId: 'thread-1',
  })
})

const chatStart = {
  threadId: 'thread-1',
  projectId: 'project-1',
  title: 'Linus · #42',
  model: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' },
  branch: 'feature',
  worktreePath: '/worktree',
  pullRequest: { host: 'github.com', repository: 'Example/Project', number: 42, url },
  message: '/slopbusters:linus Review PR #42',
}

/** An engine whose settings give new threads `defaultRuntimeMode`, recording dispatched commands. */
function engineWithSettings(settings: {
  defaultRuntimeMode: string
  projectSettingsOverrides: Record<string, { defaultRuntimeMode?: string }>
}) {
  const dispatched: unknown[] = []
  const threads = new EngineThreads(
    connectionTo({
      'server.getConfig': () => Effect.succeed({ settings }),
      'orchestration.dispatchCommand': (command: unknown) => {
        dispatched.push(command)
        return Effect.succeed({ sequence: dispatched.length })
      },
    }),
  )
  const encoded = () =>
    dispatched.map((command): Record<string, unknown> =>
      Schema.encodeUnknownSync(ClientOrchestrationCommand)(command),
    )
  return { threads, encoded }
}

it('creates, links, then starts the thread with commands the engine contract accepts', async () => {
  const { threads, encoded } = engineWithSettings({
    defaultRuntimeMode: 'full-access',
    projectSettingsOverrides: {},
  })

  await threads.startThread(chatStart)

  const commands = encoded()
  expect(commands.map((command) => command.type)).toEqual([
    'thread.create',
    'thread.pull-request.link',
    'thread.turn.start',
  ])
  expect(commands[0]).toMatchObject({
    threadId: 'thread-1',
    projectId: 'project-1',
    modelSelection: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' },
    runtimeMode: 'full-access',
    worktreePath: '/worktree',
  })
  expect(commands[1]).toMatchObject({ number: 42, repository: 'Example/Project', source: 'manual' })
  expect(commands[2]).toMatchObject({
    runtimeMode: 'full-access',
    message: { role: 'user', text: '/slopbusters:linus Review PR #42', attachments: [] },
  })
})

it('starts the thread in the runtime mode the project overrides in T3 Code', async () => {
  const { threads, encoded } = engineWithSettings({
    defaultRuntimeMode: 'full-access',
    projectSettingsOverrides: { 'project-1': { defaultRuntimeMode: 'approval-required' } },
  })

  await threads.startThread(chatStart)

  expect(encoded().map((command) => command.runtimeMode)).toEqual([
    'approval-required',
    undefined,
    'approval-required',
  ])
})
