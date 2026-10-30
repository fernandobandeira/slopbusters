import type { ComponentProps } from 'react'
import Markdown from 'react-markdown'
import { CodeReferenceText } from './CodeReferenceText'

/** A reviewer's prose: Markdown without raw HTML, where a file and line it names opens. */
export function FindingText({ children }: { children: string }) {
  return (
    <div className="finding-prose">
      <Markdown skipHtml components={{ code: InlineCode }}>
        {children}
      </Markdown>
    </div>
  )
}

/** Fenced blocks stay as they are; a single-line span may name code to open. */
function InlineCode({
  node: _node,
  children,
  className,
  ...props
}: ComponentProps<'code'> & { node?: unknown }) {
  if (typeof children !== 'string' || className || children.includes('\n'))
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  return <CodeReferenceText>{children}</CodeReferenceText>
}
