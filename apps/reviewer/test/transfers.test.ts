import { expect, it } from 'vitest'
import { createTwoFilesPatch } from 'diff'
import { parseFile } from '../server/features/diff'
import { detectTransfers } from '../server/features/transfers'
import { LineKind, TransferKind } from '../shared/domain/types'

const block =
  'export function slug(value: string) {\n  return value.trim()\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-|-$/g, "");\n}\n'

it('distinguishes an exact move from a copy of retained code', () => {
  const destination = changedFile('slug.ts', '', block)
  const transfers = detectTransfers([changedFile('utils.ts', block, ''), destination])
  const [moved] = transfers
  expect(transfers).toMatchObject([
    {
      kind: TransferKind.moved,
      fromLine: 1,
      fromEndLine: 6,
      toLine: 1,
      toEndLine: 6,
      lineCount: 6,
      changedLines: 0,
      exact: true,
      changes: [],
    },
  ])
  expect(moved?.sourceLineIds).toHaveLength(6)
  expect(moved?.destinationLineIds).toHaveLength(6)
  const [copy] = detectTransfers([
    changedFile(
      'utils.ts',
      `${block}\nexport const version = 1;\n`,
      `${block}\nexport const version = 2;\n`,
    ),
    destination,
  ])
  expect(copy).toMatchObject({
    kind: TransferKind.copied,
    fromPath: 'utils.ts',
    fromLine: 1,
    fromEndLine: 6,
    exact: true,
    sourceLineIds: [],
  })
  expect(copy?.destinationLineIds).toHaveLength(6)
})
it('ignores short boilerplate and rewritten text but follows a lightly edited block', () => {
  expect(
    detectTransfers([
      changedFile('a.ts', '}\n}\n}\n}\n', ''),
      changedFile('b.ts', '', '}\n}\n}\n}\n'),
    ]),
  ).toEqual([])
  const rewritten = block
    .replace('trim()', 'trimEnd()')
    .replace('toLowerCase()', 'toUpperCase()')
    .replace('/g, "-")', '/g, "_")')
  expect(
    detectTransfers([changedFile('a.ts', block, ''), changedFile('b.ts', '', rewritten)]),
  ).toEqual([])

  const edited = detectTransfers([
    changedFile('a.ts', block, ''),
    changedFile('b.ts', '', block.replace('trim()', 'trimEnd()')),
  ])

  expect(edited).toMatchObject([
    { kind: TransferKind.moved, lineCount: 6, changedLines: 1, exact: false },
  ])
  expect(edited[0]?.changes).toEqual([
    {
      header: '@@ -1,4 +1,4 @@',
      lines: [
        {
          kind: LineKind.context,
          text: 'export function slug(value: string) {',
          oldLine: 1,
          newLine: 1,
        },
        { kind: LineKind.removed, text: '  return value.trim()', oldLine: 2, newLine: null },
        { kind: LineKind.added, text: '  return value.trimEnd()', oldLine: null, newLine: 2 },
        { kind: LineKind.context, text: '    .toLowerCase()', oldLine: 3, newLine: 3 },
        {
          kind: LineKind.context,
          text: '    .replace(/[^a-z0-9]+/g, "-")',
          oldLine: 4,
          newLine: 4,
        },
      ],
    },
  ])
})
it('treats a moved block that only changed indentation as exact, but not one edited in place', () => {
  const indented = block
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n')

  const transfers = detectTransfers([
    changedFile('a.ts', block, ''),
    changedFile('b.ts', '', `class Slugs {\n${indented}}\n`),
  ])

  expect(transfers).toMatchObject([
    {
      kind: TransferKind.moved,
      toLine: 2,
      toEndLine: 7,
      exact: true,
      changedLines: 0,
      changes: [],
    },
  ])
  expect(
    detectTransfers([changedFile('a.ts', `a\n${block}b\n`, `a\nif (x) {\n${indented}}\nb\n`)]),
  ).toEqual([])
})
it('shows removed lines of an edited block in the destination indentation', () => {
  const indented = block
    .replace('trim()', 'trimEnd()')
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n')

  const [transfer] = detectTransfers([
    changedFile('a.ts', block, ''),
    changedFile('b.ts', '', `class Slugs {\n${indented}}\n`),
  ])

  expect(transfer?.changes[0]?.lines.filter((line) => line.kind !== LineKind.context)).toEqual([
    { kind: LineKind.removed, text: '      return value.trim()', oldLine: 2, newLine: null },
    { kind: LineKind.added, text: '      return value.trimEnd()', oldLine: null, newLine: 3 },
  ])
})
it('follows a block extracted from a function into its own, dedented and edited', () => {
  const { before, after } = extractedMatch()

  const [transfer, ...others] = detectTransfers([
    changedFile('convert.rs', before.join('\n'), after.join('\n')),
  ])

  const fromLine = before.indexOf('            match role {') + 1
  const toLine = after.indexOf('    match role {') + 1
  expect(others).toEqual([])
  expect(transfer).toMatchObject({
    kind: TransferKind.moved,
    fromPath: 'convert.rs',
    toPath: 'convert.rs',
    fromLine,
    fromEndLine: fromLine + 28,
    toLine,
    toEndLine: toLine + 28,
    lineCount: 29,
    changedLines: 4,
    exact: false,
  })
  expect(transfer?.sourceLineIds).toHaveLength(29)
  expect(transfer?.destinationLineIds).toHaveLength(29)
  expect(transfer?.changes).toHaveLength(4)
  expect(transfer?.changes[0]).toEqual({
    header: `@@ -${fromLine + 4},5 +${toLine + 4},5 @@`,
    lines: [
      expect.objectContaining({
        kind: LineKind.context,
        text: '            cache_control: None,',
      }),
      expect.objectContaining({
        kind: LineKind.context,
        text: '            metadata: metadata.clone(),',
      }),
      {
        kind: LineKind.removed,
        text: '        });',
        oldLine: fromLine + 6,
        newLine: null,
      },
      { kind: LineKind.added, text: '        },', oldLine: null, newLine: toLine + 6 },
      expect.objectContaining({
        kind: LineKind.context,
        text: '        Role::User => ChatMessage::User {',
      }),
      expect.objectContaining({
        kind: LineKind.context,
        text: '            content: text.clone(),',
      }),
    ],
  })
})
it('bounds the work on large pull requests', () => {
  const lines = (count: number, name: string) =>
    Array.from({ length: count }, (_, index) => `const ${name}${index} = compute(${index});`)
  const distinct = [
    changedFile('old.ts', `${lines(3000, 'before').join('\n')}\n`, ''),
    changedFile('new.ts', '', `${lines(3000, 'after').join('\n')}\n`),
  ]
  const shared = lines(3000, 'shared')
  const shuffled = [
    changedFile('old.ts', `${block}${shared.join('\n')}\n`, ''),
    changedFile('new.ts', '', `${shared.toReversed().join('\n')}\n${block}`),
  ]

  const started = performance.now()
  const none = detectTransfers(distinct)
  const fallback = detectTransfers(shuffled)
  const elapsed = performance.now() - started

  expect(none).toEqual([])
  expect(fallback).toMatchObject([
    { kind: TransferKind.moved, fromLine: 1, lineCount: 6, exact: true },
  ])
  expect(elapsed).toBeLessThan(3000)
})

function changedFile(path: string, old: string, current: string) {
  const raw = createTwoFilesPatch(path, path, old, current)
  const patch = raw.slice(raw.indexOf('@@'))
  const additions = patch.split('\n').filter((line) => line.startsWith('+')).length
  const deletions = patch.split('\n').filter((line) => line.startsWith('-')).length
  return parseFile({ path, status: 'modified', patch, additions, deletions, oldContent: old })
}

/** A Rust `match role` pulled out of a loop into its own function, dedented, with its arms
 * closing `},` instead of `});`. */
function extractedMatch() {
  const arm = (variant: string, closing: string, indent: string) =>
    [
      `Role::${variant} => ChatMessage::${variant} {`,
      '    content: text.clone(),',
      '    name: name.clone(),',
      '    cache_control: None,',
      '    metadata: metadata.clone(),',
      closing,
    ].map((line) => indent + line)
  const matchBlock = (closing: string, indent: string) => [
    `${indent}match role {`,
    ...['System', 'User', 'Assistant', 'Tool'].flatMap((variant) =>
      arm(variant, closing, `${indent}    `),
    ),
    `${indent}    _ => ChatMessage::Unknown {`,
    `${indent}        content: text.clone(),`,
    `${indent}    },`,
    `${indent}}`,
  ]
  const header = [
    'pub fn convert_messages(input: &[Message]) -> Vec<ChatMessage> {',
    '    let mut messages = Vec::new();',
    '    for Message { role, text, name, metadata } in input {',
  ]
  const footer = ['    }', '    messages', '}', '']
  const before = [
    ...header,
    '        messages.push(',
    ...matchBlock('});', '            '),
    '        );',
    ...footer,
  ]
  const after = [
    ...header,
    '        messages.push(role_to_chat_message(role, text, name, metadata));',
    ...footer.slice(0, -1),
    '',
    'fn role_to_chat_message(role: &Role, text: &str, name: &Name, metadata: &Meta) -> ChatMessage {',
    ...matchBlock('},', '    '),
    '}',
    '',
  ]
  return { before, after }
}
