import { createDiffWorkerHandler } from './diffWorkerHandler'
import type { WorkerRequest } from '@pierre/diffs/worker'

const handle = createDiffWorkerHandler((response) => {
  self.postMessage(response)
})
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  handle(event.data)
})
