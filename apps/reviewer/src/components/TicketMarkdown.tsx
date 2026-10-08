import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { Image as ImageIcon } from 'lucide-react'
import { displayMarkdown } from '../../shared/domain/tickets'
import '../description.css'

const schema = {
  ...defaultSchema,
  clobberPrefix: 'ticket-description-',
  strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'object', 'svg', 'math'],
  attributes: { ...defaultSchema.attributes, details: ['open'] },
}

function safeUrl(url: string): string | undefined {
  const safe = defaultUrlTransform(url)
  try {
    const parsed = new URL(safe)
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Linear uploads need the user's Linear session, so link to them instead of embedding.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a className="description-image-link" href={src} target="_blank" rel="noopener noreferrer">
        <ImageIcon size={15} aria-hidden="true" />
        {alt || 'View image attachment'}
      </a>
    ) : null,
}

/** Linear Markdown, including its `+++` collapses and issue mentions, sanitized for display. */
export function TicketMarkdown({ markdown, label }: { markdown: string; label: string }) {
  return (
    <article className="pull-description ticket-markdown" aria-label={label}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        urlTransform={(url) => safeUrl(url) ?? ''}
        components={components}
      >
        {displayMarkdown(markdown)}
      </Markdown>
    </article>
  )
}
