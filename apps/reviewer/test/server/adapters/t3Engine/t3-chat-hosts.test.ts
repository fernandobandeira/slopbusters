import { describe, expect, it, vi } from 'vitest'
import {
  EngineChatHosts,
  type BundledEngineHost,
} from '../../../../server/adapters/t3Engine/chatHosts'
import type { RunningEngine } from '../../../../server/adapters/t3Engine/engineLocation'
import type {
  EngineProject,
  EngineThreadOperations,
} from '../../../../server/adapters/t3Engine/engineThreads'
import { UserError } from '../../../../server/errors'

const repository = { owner: 'Example', repo: 'Project' }
const userProject: EngineProject = {
  id: 'user-project',
  title: 'project',
  workspaceRoot: '/code/project',
  repository: 'github.com/example/project',
}
const engine: RunningEngine = {
  home: '/data/t3-engine',
  pid: 7,
  origin: 'http://127.0.0.1:50123',
  environmentId: 'environment-1',
  serverVersion: '0.1.0',
}

function threadsWith(projects: () => Promise<EngineProject[]>) {
  const cloneProject = vi.fn((input: { destinationPath: string }) =>
    Promise.resolve({
      id: 'cloned',
      title: 'Project',
      workspaceRoot: input.destinationPath,
      repository: 'github.com/example/project',
    }),
  )
  const settleClone = vi.fn().mockResolvedValue(undefined)
  const threads = { projects, cloneProject, settleClone } as unknown as EngineThreadOperations
  return { threads, cloneProject, settleClone }
}

function bundledWith(projects: EngineProject[] = []) {
  const { threads, cloneProject, settleClone } = threadsWith(() => Promise.resolve(projects))
  const openUrl = vi.fn().mockResolvedValue(undefined)
  const bundled: BundledEngineHost = {
    engine: { cli: () => ({ command: '/app/t3', args: [], env: {} }) },
    connection: { locate: () => Promise.resolve(engine) },
    threads,
    home: '/data/t3-engine',
    openUrl,
    mintToken: () => Promise.resolve('one-time'),
  }
  return { bundled, cloneProject, settleClone, openUrl }
}

describe('choosing where a chat runs', () => {
  it("uses the user's T3 Code when it has a project for the repository", async () => {
    const user = threadsWith(() => Promise.resolve([userProject]))
    const { bundled, cloneProject } = bundledWith()
    const hosts = new EngineChatHosts({ threads: user.threads }, bundled)

    const workspace = await hosts.workspaceFor(repository)

    expect(workspace.location).toBe('t3code')
    expect(workspace.project).toBe(userProject)
    expect(cloneProject).not.toHaveBeenCalled()
  })

  it('clones into the bundled engine when T3 Code is closed or speaks another protocol', async () => {
    const user = threadsWith(() => Promise.reject(new UserError('T3 Code is not running.')))
    const { bundled, cloneProject } = bundledWith()
    const hosts = new EngineChatHosts({ threads: user.threads }, bundled)

    const workspace = await hosts.workspaceFor(repository)

    expect(workspace.location).toBe('slopbusters')
    expect(cloneProject).toHaveBeenCalledWith({
      repository: 'Example/Project',
      title: 'Project',
      destinationPath: '/data/t3-engine/repositories/Example/Project',
    })
  })

  it('clones once however many chats ask for the repository at the same time', async () => {
    const user = threadsWith(() => Promise.resolve([]))
    const { bundled, cloneProject } = bundledWith()
    const hosts = new EngineChatHosts({ threads: user.threads }, bundled)

    await Promise.all([hosts.workspaceFor(repository), hosts.workspaceFor(repository)])

    expect(cloneProject).toHaveBeenCalledTimes(1)
  })

  it('reuses the bundled project by its checkout, waiting out a clone still in progress', async () => {
    const user = threadsWith(() => Promise.resolve([]))
    const cloning = {
      id: 'cloning',
      title: 'Project',
      workspaceRoot: '/data/t3-engine/repositories/Example/Project',
    }
    const { bundled, cloneProject, settleClone } = bundledWith([cloning])
    const hosts = new EngineChatHosts({ threads: user.threads }, bundled)

    const workspace = await hosts.workspaceFor(repository)

    expect(workspace.project).toBe(cloning)
    expect(settleClone).toHaveBeenCalledWith('cloning')
    expect(cloneProject).not.toHaveBeenCalled()
  })

  it('asks for a T3 Code project when this build has no bundled engine', async () => {
    const user = threadsWith(() => Promise.resolve([]))
    const hosts = new EngineChatHosts({ threads: user.threads })

    await expect(hosts.workspaceFor(repository)).rejects.toThrow(
      'Add your Example/Project checkout as a project in T3 Code',
    )
  })
})

it("opens a bundled chat on the engine's thread page, signed in by a one-time token", async () => {
  const user = threadsWith(() => Promise.resolve([]))
  const { bundled, openUrl } = bundledWith()
  const workspace = await new EngineChatHosts({ threads: user.threads }, bundled).workspaceFor(
    repository,
  )

  await workspace.open('thread-1')

  expect(openUrl).toHaveBeenCalledWith(
    'http://127.0.0.1:50123/environment-1/thread-1#token=one-time',
  )
})
