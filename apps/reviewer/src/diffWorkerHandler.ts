import {
  renderFileWithHighlighter,
  replaceCustomExtensions,
  type DiffsHighlighter,
} from '@pierre/diffs'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import type { WorkerRequest, WorkerResponse, WorkerRenderingOptions } from '@pierre/diffs/worker'
import { renderContextualDiff } from './syntaxContext'

/** Pierre's public worker protocol, with full-source lexical context for partial diffs. */
export function createDiffWorkerHandler(send: (response: WorkerResponse) => void) {
  let highlighter: DiffsHighlighter | undefined
  let options: WorkerRenderingOptions | undefined
  let pending = Promise.resolve()
  async function handle(request: WorkerRequest) {
    try {
      if (request.type === 'initialize') {
        // The worker receives languages/themes from Pierre instead of bundling its full
        // catalog. Its renderer uses the same core APIs as the upstream Pierre worker.
        highlighter = await createHighlighterCore({
          themes: [], langs: [], engine: request.preferredHighlighter === 'shiki-wasm'
            ? createOnigurumaEngine(import('shiki/wasm')) : createJavaScriptRegexEngine(),
        }) as DiffsHighlighter
      }
      if (!highlighter) throw new Error('Diff highlighter has not initialized')
      if ('resolvedThemes' in request) {
        for (const theme of request.resolvedThemes) highlighter.loadThemeSync(theme)
      }
      if ('resolvedLanguages' in request && request.resolvedLanguages) {
        for (const language of request.resolvedLanguages) highlighter.loadLanguageSync(language.data)
      }
      if ('customExtensionsVersion' in request && request.customExtensionsVersion !== undefined && request.customExtensionMap !== undefined) {
        replaceCustomExtensions(request.customExtensionsVersion, request.customExtensionMap)
      }
      if (request.type === 'initialize' || request.type === 'set-render-options') {
        options = request.renderOptions
        send({ type: 'success', requestType: request.type, id: request.id, sentAt: Date.now() })
      } else {
        if (!options) throw new Error('Diff rendering options have not initialized')
        if (request.type === 'diff') {
          send({ type: 'success', requestType: 'diff', id: request.id, options,
            result: renderContextualDiff(request.diff, highlighter, options), sentAt: Date.now() })
        } else {
          send({ type: 'success', requestType: 'file', id: request.id, options,
            result: renderFileWithHighlighter(request.file, highlighter, options), sentAt: Date.now() })
        }
      }
    } catch (error) {
      send({ type: 'error', id: request.id, error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined })
    }
  }
  return (request: WorkerRequest) => { pending = pending.then(() => handle(request)) }
}
