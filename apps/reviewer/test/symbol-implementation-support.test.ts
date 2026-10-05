import { describe, expect, it } from 'vitest'
import { symbolImplementationSupport } from '../server/symbolImplementationSupport'

function support(source: string, name: string) {
  const offset = source.lastIndexOf(name)
  const lines = source.slice(0, offset).split('\n')
  return symbolImplementationSupport(
    'source.ts',
    source,
    lines.length,
    (lines.at(-1)?.length ?? 0) + 1,
  )
}

describe('implementation action eligibility', () => {
  it.each([
    ['interface Account { run(): void }; let account: Account', 'Account'],
    ['abstract class Account { abstract run(): void }; let account: Account', 'Account'],
    ['type Account = { id: string }; let account: Account', 'Account'],
    ['type Account = { id: string } & { name: string }; let account: Account', 'Account'],
    ['interface Account { run(): void }; let account: Account; account.run()', 'run'],
    ['interface Account { id: string }; let account: Account; account.id', 'id'],
  ])('offers implementations for %s', (source, name) => {
    expect(support(source, name)).toBe(true)
  })
  it.each([
    ['function run() {}; run()', 'run'],
    ['const run = () => {}; run()', 'run'],
    ['const count = 1; count', 'count'],
    ['enum Status { open }; Status', 'Status'],
    ['type Account = string; let account: Account', 'Account'],
    [
      'type Account = { id: string } & ({ kind: "a" } | { kind: "b" }); let account: Account',
      'Account',
    ],
  ])('hides implementations for %s', (source, name) => {
    expect(support(source, name)).toBe(false)
  })
  it('preserves the unknown state for imports, unresolved names and unsupported languages', () => {
    expect(support('import { Account } from "./types"; let account: Account', 'Account')).toBeNull()
    expect(support('let account: Unknown', 'Unknown')).toBeNull()
    expect(symbolImplementationSupport('source.go', 'type Account interface {}', 1, 6)).toBeNull()
    expect(symbolImplementationSupport('source.ts', 'const count = 1', 2, 1)).toBeNull()
  })
  it('recognizes a JavaScript base class without loading project configuration', () => {
    expect(symbolImplementationSupport('src/account.js', 'class Account {}', 1, 7)).toBe(true)
  })
})
