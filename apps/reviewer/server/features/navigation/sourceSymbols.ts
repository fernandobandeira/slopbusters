import { MAX_SYMBOL_SOURCE_CHARS } from '../../limits'
import ts from 'typescript'
import type { SourceSymbol } from '../../../shared/domain/sourceSymbols'

const maximumSourceLength = MAX_SYMBOL_SOURCE_CHARS
const maximumSymbols = 400
const maximumDepth = 100

/** Parse source without resolving imports, loading a project, or executing reviewed code. */
export function getSourceSymbols(path: string, content: string): SourceSymbol[] {
  const extension = path.split('.').at(-1)?.toLowerCase()
  const scriptKind =
    extension === 'tsx'
      ? ts.ScriptKind.TSX
      : extension === 'jsx'
        ? ts.ScriptKind.JSX
        : ['ts', 'mts', 'cts'].includes(extension ?? '')
          ? ts.ScriptKind.TS
          : ['js', 'mjs', 'cjs'].includes(extension ?? '')
            ? ts.ScriptKind.JS
            : undefined
  if (scriptKind == null || content.length > maximumSourceLength) return []

  try {
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, scriptKind)
    const symbols: SourceSymbol[] = []
    const shortName = (node: ts.Node) => node.getText(source).replace(/\s+/g, ' ').slice(0, 100)

    function visit(node: ts.Node, parent: ts.Node | undefined, scope: string[], depth: number) {
      if (depth > maximumDepth || symbols.length >= maximumSymbols) return
      let name: string | undefined
      let kind: SourceSymbol['kind'] | undefined
      let location = node
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        name = node.name ? shortName(node.name) : undefined
        kind = 'class'
      } else if (ts.isFunctionDeclaration(node)) {
        name = node.name ? shortName(node.name) : undefined
        kind = 'function'
      } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
        name = shortName(node.name)
        kind = 'method'
      } else if (ts.isConstructorDeclaration(node)) {
        name = 'constructor'
        kind = 'method'
      } else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        name = `${ts.isGetAccessorDeclaration(node) ? 'get' : 'set'} ${shortName(node.name)}`
        kind = 'method'
      } else if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        kind = 'function'
        name = ts.isFunctionExpression(node) && node.name ? shortName(node.name) : undefined
      }

      if (
        kind &&
        parent &&
        (ts.isVariableDeclaration(parent) ||
          ts.isPropertyDeclaration(parent) ||
          ts.isPropertyAssignment(parent)) &&
        parent.initializer === node
      ) {
        name = shortName(parent.name)
        location = parent
        if (ts.isPropertyDeclaration(parent) && kind === 'function') kind = 'method'
      }

      const nextScope = name && kind ? [...scope, name] : scope
      if (name && kind) {
        symbols.push({
          name: nextScope.join('.'),
          kind,
          line: source.getLineAndCharacterOfPosition(location.getStart(source)).line + 1,
          endLine:
            source.getLineAndCharacterOfPosition(
              Math.max(location.getStart(source), location.end - 1),
            ).line + 1,
        })
      }
      ts.forEachChild(node, (child) => {
        visit(child, node, nextScope, depth + 1)
      })
    }
    visit(source, undefined, [], 0)
    return symbols
  } catch {
    // An outline is optional: malformed or excessively nested code remains reviewable.
    return []
  }
}
