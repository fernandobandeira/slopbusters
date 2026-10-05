import { z } from 'zod'
import type { DiffSide } from '../shared/types'
import {
  setupRequestSchema,
  workspaceSetupSchema,
  type SetupRequest,
} from '../shared/workspaceSetup'
import { api } from './api'

export async function listWorkspaceSetups(signal?: AbortSignal) {
  return z.array(workspaceSetupSchema).parse(await api<unknown>('/workspace-setups', { signal }))
}
export async function getWorkspaceSetup(id: string, signal?: AbortSignal) {
  return workspaceSetupSchema.parse(
    await api<unknown>(`/workspace-setups/${encodeURIComponent(id)}`, { signal }),
  )
}
export async function planWorkspaceSetup(pullId: string, request: SetupRequest) {
  return workspaceSetupSchema.parse(
    await api<unknown>(`/pulls/${encodeURIComponent(pullId)}/workspace-setup`, {
      method: 'POST',
      body: JSON.stringify(setupRequestSchema.parse(request)),
    }),
  )
}
export async function approveWorkspaceSetup(pullId: string, id: string, side: DiffSide) {
  return workspaceSetupSchema.parse(
    await api<unknown>(
      `/pulls/${encodeURIComponent(pullId)}/workspace-setup/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ side, approved: true }),
      },
    ),
  )
}
export async function clearWorkspaceSetup(id: string) {
  return workspaceSetupSchema.parse(
    await api<unknown>(`/workspace-setups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  )
}
