import { beforeAll, describe, expect, it } from 'vitest'
import {
  getSharedHighlighter,
  parsePatchFiles,
  renderDiffWithHighlighter,
  renderFileWithHighlighter,
  type DiffsHighlighter,
  type RenderDiffOptions,
} from '@pierre/diffs'
import { renderContextualDiff, type ContextualFileDiff } from '../src/syntaxContext'
import { createDiffWorkerHandler } from '../src/diffWorkerHandler'
import { resolveLanguages, resolveTheme } from '@pierre/diffs'
import type { WorkerResponse } from '@pierre/diffs/worker'
import { createResilientDiffWorker } from '../src/resilientDiffWorker'

const options: RenderDiffOptions = {
  theme: 'catppuccin-mocha', useTokenTransformer: true, tokenizeMaxLineLength: 1000,
  lineDiffType: 'word-alt', maxLineDiffLength: 1000,
}
const oldSource = [
  'class Review {',
  '  private async load() {',
  '    const value = 1;',
  '    return value;',
  '  }',
  '  /*',
  '   private async const words are comments',
  '  */',
  '  private async save() {',
  '    const text = "private async const";',
  '    return text;',
  '  }',
  '}',
  '',
].join('\n')
const newSource = oldSource.replace('value = 1', 'value = 2').replace('return text;', 'return text.trim();')
function fixture(): ContextualFileDiff {
  const patch = [
    'diff --git a/review.ts b/review.ts', '--- a/review.ts', '+++ b/review.ts',
    '@@ -2,3 +2,3 @@', '   private async load() {', '-    const value = 1;',
    '+    const value = 2;', '     return value;',
    '@@ -7,1 +7,1 @@', '-   private async const words are comments',
    '+   private async const words are comments',
    '@@ -9,3 +9,3 @@', '   private async save() {', '     const text = "private async const";',
    '-    return text;', '+    return text.trim();', '',
  ].join('\n')
  return {
    ...parsePatchFiles(patch)[0].files[0],
    syntaxContext: {
      old: { path: 'review.ts', sha: 'base', content: oldSource, symbols: [] },
      new: { path: 'review.ts', sha: 'head', content: newSource, symbols: [] },
    },
  }
}

// Compare token children, excluding Pierre's source-coordinate properties on the enclosing line.
function tokens(line: unknown) {
  return JSON.stringify((line as { children: unknown[] }).children)
}

describe('full-source grammar for partial diffs', () => {
  let highlighter: DiffsHighlighter
  beforeAll(async () => {
    highlighter = await getSharedHighlighter({ themes: ['catppuccin-mocha'], langs: ['typescript'], preferredHighlighter: 'shiki-wasm' })
  })

  it('matches full-file colors across separated class hunks, strings and multiline comments', () => {
    const diff = fixture()
    const original = structuredClone(diff)
    const result = renderContextualDiff(diff, highlighter, options)
    for (const side of ['old', 'new'] as const) {
      const source = diff.syntaxContext![side]!
      const full = renderFileWithHighlighter({ name: source.path, contents: source.content }, highlighter, options)
      const rendered = side === 'old' ? result.code.deletionLines : result.code.additionLines
      for (const line of rendered) {
        const number = Number((line as { properties: Record<string, unknown> }).properties['data-line'])
        // Word-diff wrappers differ on changed lines; unchanged keyword/string/comment lines match exactly.
        if ([2, 7, 9, 10].includes(number)) expect(tokens(line)).toBe(tokens(full.code[number - 1]))
      }
    }
    expect(diff).toEqual(original)
    expect(result.code.additionLines).toHaveLength(7)
    // The class header and omitted changed gaps never appear as context in the partial display.
    expect(JSON.stringify(result.code)).not.toContain('class Review')
    const isolated = renderDiffWithHighlighter(diff, highlighter, options)
    expect(tokens(result.code.additionLines[0])).not.toBe(tokens(isolated.code.additionLines[0]))
  })

  it('refuses grammar context when a source revision disagrees with the displayed hunk', () => {
    const diff = fixture()
    diff.syntaxContext!.new!.content = '/* stale revision */\n'
    const result = renderContextualDiff(diff, highlighter, options)
    const isolated = renderDiffWithHighlighter(diff, highlighter, options)
    expect(result.code.additionLines).toEqual(isolated.code.additionLines)
  })

  it('runs the same contextual renderer through the worker protocol on the main thread', async () => {
    const responses: WorkerResponse[] = []
    let complete: (() => void) | undefined
    const finished = new Promise<void>((resolve) => { complete = resolve })
    const handle = createDiffWorkerHandler((response) => {
      responses.push(response)
      if (response.id === 'diff') complete!()
    })
    handle({ type: 'initialize', id: 'init', renderOptions: options,
      preferredHighlighter: 'shiki-wasm', resolvedThemes: [await resolveTheme('catppuccin-mocha')],
      resolvedLanguages: await resolveLanguages(['typescript']) })
    handle({ type: 'diff', id: 'diff', diff: fixture() })
    await finished
    const response = responses[1]
    expect(response.type).toBe('success')
    if (response.type === 'success' && response.requestType === 'diff') {
      expect(response.result).toEqual(renderContextualDiff(fixture(), highlighter, options))
    }
  })

  it('keeps contextual colors when worker construction is blocked', async () => {
    const worker = createResilientDiffWorker(() => { throw new Error('Workers blocked') })
    const finished = new Promise<WorkerResponse>((resolve) => {
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id === 'diff') resolve(event.data)
      })
    })
    worker.postMessage({ type: 'initialize', id: 'init', renderOptions: options,
      preferredHighlighter: 'shiki-wasm', resolvedThemes: [await resolveTheme('catppuccin-mocha')],
      resolvedLanguages: await resolveLanguages(['typescript']) })
    worker.postMessage({ type: 'diff', id: 'diff', diff: fixture() })
    const response = await finished
    expect(response.type).toBe('success')
    if (response.type === 'success' && response.requestType === 'diff') {
      expect(response.result).toEqual(renderContextualDiff(fixture(), highlighter, options))
    }
    worker.terminate()
  })

  it('restores previously loaded language and theme state after a worker crashes', async () => {
    const fake = Object.assign(new EventTarget(), {
      postMessage(request: { id: string; type: string }) {
        if (request.type === 'diff') fake.dispatchEvent(new Event('error', { cancelable: true }))
        else queueMicrotask(() => fake.dispatchEvent(new MessageEvent('message', { data: {
          type: 'success', requestType: request.type, id: request.id, sentAt: Date.now(),
        } })))
      },
      terminate() {},
    }) as unknown as Worker
    const worker = createResilientDiffWorker(() => fake)
    const theme = await resolveTheme('catppuccin-mocha')
    const languages = await resolveLanguages(['typescript'])
    await new Promise<void>((resolve) => {
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id === 'init') resolve()
      })
      worker.postMessage({ type: 'initialize', id: 'init', renderOptions: options,
        preferredHighlighter: 'shiki-wasm', resolvedThemes: [theme], resolvedLanguages: languages })
    })
    const finished = new Promise<WorkerResponse>((resolve) => {
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id === 'diff') resolve(event.data)
      })
    })
    // The pool need not retransmit a language already loaded in the crashed worker.
    worker.postMessage({ type: 'diff', id: 'diff', diff: fixture() })
    const response = await finished
    expect(response.type).toBe('success')
    if (response.type === 'success' && response.requestType === 'diff') {
      expect(response.result).toEqual(renderContextualDiff(fixture(), highlighter, options))
    }
    worker.terminate()
  })
})
