import { describe, expect, it } from 'vitest'
import { getSourceSymbols } from '../server/features/navigation/sourceSymbols'

describe('source revision outlines', () => {
  it('identifies enclosing classes, private async methods, and nested functions at exact lines', () => {
    const content = [
      'export class AccountProvider {',
      '  private async findAccount(id: string) {',
      '    function validate() { return id.length > 0 }',
      '    return validate()',
      '  }',
      '}',
    ].join('\r\n')
    expect(getSourceSymbols('src/provider.ts', content)).toEqual([
      { name: 'AccountProvider', kind: 'class', line: 1, endLine: 6 },
      { name: 'AccountProvider.findAccount', kind: 'method', line: 2, endLine: 5 },
      { name: 'AccountProvider.findAccount.validate', kind: 'function', line: 3, endLine: 3 },
    ])
  })

  it('supports JSX, arrows, class fields, constructors and accessors', () => {
    const content = [
      'export const Screen = () => <div>private async const</div>',
      'class Service {',
      '  constructor() {}',
      '  get value() { return 1 }',
      '  set value(next) {}',
      '  run = async () => true',
      '}',
    ].join('\n')
    expect(getSourceSymbols('ui.jsx', content).map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: 'Screen', kind: 'function' },
      { name: 'Service', kind: 'class' },
      { name: 'Service.constructor', kind: 'method' },
      { name: 'Service.get value', kind: 'method' },
      { name: 'Service.set value', kind: 'method' },
      { name: 'Service.run', kind: 'method' },
    ])
  })

  it('does not invent symbols from comments, strings or unnamed callbacks', () => {
    expect(
      getSourceSymbols(
        'fixture.mts',
        [
          '// async function imaginary() {}',
          'const text = "class Hidden { private run() {} }"',
          'items.map(async () => 1)',
          'const actual = function internalName() { return 1 }',
        ].join('\n'),
      ),
    ).toEqual([{ name: 'actual', kind: 'function', line: 4, endLine: 4 }])
  })

  it('keeps partial source usable and declines unsupported or oversized sources', () => {
    expect(getSourceSymbols('fixture.cts', 'function unfinished() {')).toEqual([
      { name: 'unfinished', kind: 'function', line: 1, endLine: 1 },
    ])
    expect(getSourceSymbols('fixture.py', 'def example(): pass')).toEqual([])
    expect(getSourceSymbols('fixture.ts', ' '.repeat(500_001))).toEqual([])
    expect(
      getSourceSymbols(
        'fixture.js',
        Array.from({ length: 500 }, (_, i) => `function f${i}() {}`).join('\n'),
      ),
    ).toHaveLength(400)
  })
})
