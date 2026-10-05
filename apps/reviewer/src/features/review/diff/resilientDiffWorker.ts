import type {
  InitializeWorkerRequest,
  ResolvedLanguage,
  SetRenderOptionsWorkerRequest,
  WorkerRequest,
  WorkerResponse,
} from '@pierre/diffs/worker'
import { createDiffWorkerHandler } from './diffWorkerHandler'

/** Preserve the contextual renderer if a browser refuses workers or a worker crashes. */
export function createResilientDiffWorker(factory: () => Worker): Worker {
  const events = new EventTarget()
  let terminated = false
  let worker: Worker | undefined
  let initialize: InitializeWorkerRequest | undefined
  let latestOptions: SetRenderOptionsWorkerRequest | undefined
  const pending = new Map<string, WorkerRequest>()
  const languages = new Map<string, ResolvedLanguage>()
  const privateSetupIds = new Set<string>()
  const receive = (response: WorkerResponse) => {
    if (terminated || privateSetupIds.delete(response.id)) return
    pending.delete(response.id)
    events.dispatchEvent(new MessageEvent('message', { data: response }))
  }
  let inline: ReturnType<typeof createDiffWorkerHandler> | undefined
  const fallback = () => {
    if (terminated || inline) return
    worker?.terminate()
    worker = undefined
    inline = createDiffWorkerHandler(receive)
    // Recreate worker state before resubmitting active renders. Completed setup responses
    // have no active Pierre task and are deliberately consumed inside this adapter.
    if (initialize && !pending.has(initialize.id)) {
      const id = `inline-init:${initialize.id}`
      privateSetupIds.add(id)
      inline({ ...initialize, id, resolvedLanguages: [...languages.values()] })
    }
    if (latestOptions && !pending.has(latestOptions.id)) {
      const id = `inline-options:${latestOptions.id}`
      privateSetupIds.add(id)
      inline({ ...latestOptions, id })
    }
    for (const request of pending.values()) {
      inline(
        request.type === 'initialize'
          ? { ...request, resolvedLanguages: [...languages.values()] }
          : request,
      )
    }
  }
  try {
    worker = factory()
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      receive(event.data)
    })
    worker.addEventListener('error', (event) => {
      event.preventDefault()
      fallback()
    })
  } catch {
    fallback()
  }
  return Object.assign(events, {
    postMessage(request: WorkerRequest) {
      if (terminated) return
      const snapshot = structuredClone(request)
      if ('resolvedLanguages' in snapshot) {
        for (const language of snapshot.resolvedLanguages ?? [])
          languages.set(language.name, language)
      }
      if (snapshot.type === 'initialize') initialize = snapshot
      if (snapshot.type === 'set-render-options') latestOptions = snapshot
      pending.set(snapshot.id, snapshot)
      if (inline) inline(snapshot)
      else {
        try {
          worker!.postMessage(snapshot)
        } catch {
          fallback()
        }
      }
    },
    terminate() {
      terminated = true
      pending.clear()
      worker?.terminate()
    },
  }) as unknown as Worker
}
