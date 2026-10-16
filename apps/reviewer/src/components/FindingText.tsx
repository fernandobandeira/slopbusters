import Markdown from 'react-markdown'

/** A reviewer's prose: Markdown without raw HTML. */
export function FindingText({ children }: { children: string }) {
  return (
    <div className="finding-prose">
      <Markdown skipHtml>{children}</Markdown>
    </div>
  )
}
