import { Parser, Language, type Node } from '@vscode/tree-sitter-wasm'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { SourceSymbol } from '../shared/sourceSymbols'
import { getSourceSymbols } from './sourceSymbols'
import type { NavigationTarget } from '../shared/navigation'
import { sourceLanguage } from '../shared/languages'
export { sourceLanguage } from '../shared/languages'

let sourceAssetsDirectory: string | undefined
let initialized: Promise<void> | undefined
const languages = new Map<string, Promise<Language>>()

export function configureSourceAssetsDirectory(directory?: string) {
  if (directory) sourceAssetsDirectory = directory
}

function assetsDirectory(): string {
  if (sourceAssetsDirectory) return sourceAssetsDirectory
  for (const location of [process.cwd(), resolve(process.cwd(), 'apps/reviewer')]) {
    try {
      return dirname(
        createRequire(resolve(location, 'package.json')).resolve('@vscode/tree-sitter-wasm'),
      )
    } catch {
      /* Development can start from the workspace root or reviewer package. */
    }
  }
  throw new Error('Bundled source parsers could not be located.')
}

const grammarLanguages = new Set([
  'python', 'go', 'rust', 'java', 'ruby', 'php', 'c_sharp', 'cpp', 'c', 'bash', 'powershell',
])

const classNodes = new Set([
  'class_definition',
  'class_declaration',
  'class_specifier',
  'struct_specifier',
  'struct_item',
  'enum_item',
  'trait_item',
  'impl_item',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'module',
  'class',
])
const functionNodes = new Set([
  'function_definition',
  'function_item',
  'function_declaration',
  'method_definition',
  'method_declaration',
  'constructor_declaration',
  'local_function_statement',
  'method',
  'singleton_method',
  'function_statement',
])

function declarationName(node: Node): string | undefined {
  const name = node.childForFieldName('name')
  if (name) return name.text
  if (node.type === 'impl_item') return node.childForFieldName('type')?.text
  let declarator = node.childForFieldName('declarator')
  for (let depth = 0; declarator && depth < 12; depth++) {
    const nested = declarator.childForFieldName('declarator')
    if (!nested) return declarator.text.replace(/\(.*$/s, '').trim()
    declarator = nested
  }
  if (node.type === 'function_statement')
    return node.namedChildren.find((child) => child && /name/.test(child.type))?.text
  return undefined
}

/** Grammars ship in the desktop bundle and are loaded on demand, without user installation. */
async function withSyntaxTree<T>(
  path: string,
  content: string,
  read: (root: Node) => T,
): Promise<T | undefined> {
  const language = sourceLanguage(path)
  if (!grammarLanguages.has(language) || content.length > 500_000) return undefined
  const directory = assetsDirectory()
  initialized ??= Parser.init({ locateFile: (file) => resolve(directory, file) })
  await initialized
  let grammar = languages.get(language)
  if (!grammar) {
    grammar = Language.load(
      resolve(directory, `tree-sitter-${language === 'c_sharp' ? 'c-sharp' : language === 'c' ? 'cpp' : language}.wasm`),
    )
    languages.set(language, grammar)
  }
  const parser = new Parser()
  parser.setLanguage(await grammar)
  parser.setTimeoutMicros(100_000)
  let tree: ReturnType<Parser['parse']> = null
  try {
    tree = parser.parse(content)
    return tree ? read(tree.rootNode) : undefined
  } finally {
    tree?.delete()
    parser.delete()
  }
}

export async function getRevisionSymbols(path: string, content: string): Promise<SourceSymbol[]> {
  const language = sourceLanguage(path)
  if (language === 'typescript' || language === 'javascript') return getSourceSymbols(path, content)
  return (
    (await withSyntaxTree(path, content, (root) => {
      const symbols: SourceSymbol[] = []
      function visit(node: Node, scope: string[], depth: number) {
        if (depth > 100 || symbols.length >= 400) return
        const kind: SourceSymbol['kind'] | undefined = classNodes.has(node.type)
          ? 'class'
          : functionNodes.has(node.type)
            ? scope.length || /method|constructor/.test(node.type)
              ? 'method'
              : 'function'
            : undefined
        const name = kind ? declarationName(node)?.replace(/\s+/g, ' ').slice(0, 100) : undefined
        const nextScope = name ? [...scope, name] : scope
        if (name && kind)
          symbols.push({
            name: nextScope.join('.'),
            kind,
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + (node.endPosition.column === 0 ? 0 : 1),
          })
        for (const child of node.namedChildren) if (child) visit(child, nextScope, depth + 1)
      }
      visit(root, [], 0)
      return symbols
    })) ?? []
  )
}

/** Syntax matches intentionally do not claim to resolve a symbol's type or scope. */
export async function getSyntaxIdentifierLocations(
  path: string,
  content: string,
  name: string,
): Promise<NavigationTarget[] | undefined> {
  return withSyntaxTree(path, content, (root) => {
    const targets: NavigationTarget[] = []
    function visit(node: Node, depth: number) {
      if (depth > 100 || targets.length >= 500) return
      if (
        node.namedChildCount === 0 &&
        /identifier|name|constant|word/.test(node.type) &&
        node.text === name
      ) {
        targets.push({
          path,
          name,
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column + 1,
        })
      }
      for (const child of node.namedChildren) if (child) visit(child, depth + 1)
    }
    visit(root, 0)
    return targets
  })
}
