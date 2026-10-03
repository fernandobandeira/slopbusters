import { describe, expect, it } from 'vitest'
import { getRevisionSymbols, sourceLanguage } from '../server/treeSymbols'

describe('bundled language outlines', () => {
  it.each([
    [
      'provider.py',
      'class Provider:\n    async def fetch(self):\n        return 1\n',
      ['Provider', 'Provider.fetch'],
    ],
    ['provider.go', 'package main\nfunc fetch() int { return 1 }', ['fetch']],
    [
      'provider.rs',
      'struct Provider {}\nimpl Provider { fn fetch(&self) -> i32 { 1 } }',
      ['Provider', 'Provider', 'Provider.fetch'],
    ],
    [
      'Provider.java',
      'class Provider { public int fetch() { return 1; } }',
      ['Provider', 'Provider.fetch'],
    ],
    [
      'Provider.cs',
      'class Provider { public int Fetch() { return 1; } }',
      ['Provider', 'Provider.Fetch'],
    ],
    [
      'provider.cpp',
      'class Provider { int fetch() { return 1; } };',
      ['Provider', 'Provider.fetch'],
    ],
    [
      'provider.rb',
      'class Provider\n  def fetch\n    1\n  end\nend',
      ['Provider', 'Provider.fetch'],
    ],
    [
      'provider.php',
      '<?php class Provider { function fetch() { return 1; } }',
      ['Provider', 'Provider.fetch'],
    ],
    ['provider.sh', 'fetch() { echo ready; }', ['fetch']],
  ])('extracts actual syntax in %s', async (path, content, expected) => {
    expect((await getRevisionSymbols(path, content)).map((symbol) => symbol.name)).toEqual(expected)
  })

  it('detects languages per file and keeps unknown files browsable', async () => {
    expect(sourceLanguage('src/Provider.TSX')).toBe('typescript')
    expect(sourceLanguage('src/provider.pyi')).toBe('python')
    expect(await getRevisionSymbols('fixture.unknown', 'function imaginary() {}')).toEqual([])
    expect(
      await getRevisionSymbols('fixture.py', '# def imaginary(): pass\ntext = "def fake(): pass"'),
    ).toEqual([])
  })
})
