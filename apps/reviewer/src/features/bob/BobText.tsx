import Markdown from 'react-markdown'

export function BobText({ children }: { children: string }) {
  return (
    <div className="bob-prose">
      <Markdown skipHtml>{children}</Markdown>
    </div>
  )
}
