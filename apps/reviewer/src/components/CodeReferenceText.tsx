import { createContext, useContext, type ReactNode } from 'react'
import { parseCodeReference, type CodeReference } from '../../shared/domain/codeReferences'

/** Opens a place in the PR's code; absent where there is no PR to open it in. */
const OpenCodeContext = createContext<((reference: CodeReference) => void) | undefined>(undefined)

export function OpenCodeProvider({
  open,
  children,
}: {
  open: (reference: CodeReference) => void
  children: ReactNode
}) {
  return <OpenCodeContext value={open}>{children}</OpenCodeContext>
}

/** Inline code; a file and line it names opens that code when clicked. */
export function CodeReferenceText({ children }: { children: string }) {
  const open = useContext(OpenCodeContext)
  const reference = open ? parseCodeReference(children) : undefined
  if (!open || !reference) return <code>{children}</code>
  return (
    <button
      type="button"
      className="code-reference"
      title={`Open ${children}`}
      onClick={() => {
        open(reference)
      }}
    >
      <code>{children}</code>
    </button>
  )
}
