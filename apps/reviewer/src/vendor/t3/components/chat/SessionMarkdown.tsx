import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

// T3 Code ChatMarkdown's sanitized Markdown pipeline, with app-specific actions omitted.
export function SessionMarkdown({text}: {text: string}) {
  return <div className="session-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={{
    a: ({children, href}) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: ({alt}) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
  }}>{text}</ReactMarkdown></div>
}
