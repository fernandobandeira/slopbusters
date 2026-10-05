import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { Check, Copy, Image as ImageIcon } from 'lucide-react'
import type { PullRequest } from '../../../shared/domain/types'
import '../../description.css'

const anchorPrefix = 'pull-description-'
const descriptionSchema = {
  ...defaultSchema,
  clobberPrefix: anchorPrefix,
  strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'object', 'svg', 'math'],
  attributes: { ...defaultSchema.attributes, details: ['open'] },
}

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] }
function plainText(node: MarkdownNode | undefined): string {
  return node?.value ?? node?.children?.map(plainText).join('') ?? ''
}

/** Description links resolve against the PR's source branch, never the local application. */
function descriptionUrl(url: string, pull: PullRequest): string | undefined {
  const safe = defaultUrlTransform(url)
  if (!safe) return undefined
  if (safe.startsWith('#')) return `#${anchorPrefix}${safe.slice(1)}`
  try {
    const base = `https://github.com/${pull.owner}/${pull.repo}/blob/${encodeURIComponent(pull.headBranch)}/`
    const resolved = new URL(safe, base)
    return ['https:', 'http:', 'mailto:'].includes(resolved.protocol) ? resolved.href : undefined
  } catch {
    return undefined
  }
}

function githubImage(src: string): boolean {
  try {
    const url = new URL(src)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com'))
    )
  } catch {
    return false
  }
}

function DescriptionCode({
  children,
  text,
  language,
}: {
  children: ReactNode
  text: string
  language?: string
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => {
      setCopyState('idle')
    }, 2500)
    return () => {
      clearTimeout(timer)
    }
  }, [copyState])
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  return (
    <div className="description-code-block">
      <div className="description-code-toolbar">
        <span>{language ?? 'Code'}</span>
        <button type="button" onClick={() => void copy()} aria-label="Copy code block">
          {copyState === 'copied' ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <Copy size={13} aria-hidden="true" />
          )}
          <span aria-live="polite">
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
          </span>
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

export function PullDescription({ pull, focusQuote }: { pull: PullRequest; focusQuote?: string }) {
  const article = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = article.current
    if (!root || !focusQuote) return
    const target = [...root.querySelectorAll<HTMLElement>('[data-source-start]')]
      .filter((element) => {
        const start = Number(element.dataset.sourceStart)
        const end = Number(element.dataset.sourceEnd)
        const index = pull.description.indexOf(focusQuote)
        return index >= start && index < end
      })
      .sort(
        (a, b) =>
          Number(a.dataset.sourceEnd) -
          Number(a.dataset.sourceStart) -
          (Number(b.dataset.sourceEnd) - Number(b.dataset.sourceStart)),
      )[0]
    if (!target) return
    for (
      let ancestor: HTMLElement | null = target;
      ancestor && ancestor !== root;
      ancestor = ancestor.parentElement
    )
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
    target.classList.add('linus-highlight')
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', behavior: 'instant' })
    })
    return () => {
      cancelAnimationFrame(frame)
      target.classList.remove('linus-highlight')
    }
  }, [focusQuote, pull.description])
  const focused = Boolean(focusQuote)
  // Markdown treats these renderers as component types. Keep their identities stable so
  // session polling and bubble interactions don't replace the highlighted DOM element.
  const components = useMemo<Components>(
    () => ({
      ...(focused &&
        ({
          p: ({ node, children }) => (
            <p
              data-source-start={node?.position?.start.offset}
              data-source-end={node?.position?.end.offset}
            >
              {children}
            </p>
          ),
          h1: ({ node, children }) => (
            <h1
              data-source-start={node?.position?.start.offset}
              data-source-end={node?.position?.end.offset}
            >
              {children}
            </h1>
          ),
          h2: ({ node, children }) => (
            <h2
              data-source-start={node?.position?.start.offset}
              data-source-end={node?.position?.end.offset}
            >
              {children}
            </h2>
          ),
          h3: ({ node, children }) => (
            <h3
              data-source-start={node?.position?.start.offset}
              data-source-end={node?.position?.end.offset}
            >
              {children}
            </h3>
          ),
          li: ({ node, children, ...props }) => (
            <li
              {...props}
              data-source-start={node?.position?.start.offset}
              data-source-end={node?.position?.end.offset}
            >
              {children}
            </li>
          ),
          details: ({ node, children, open }) => (
            <details
              open={open}
              data-source-start={node?.position?.start.offset}
              data-source-end={node?.position?.end.offset}
            >
              {children}
            </details>
          ),
        } satisfies Components)),
      a: ({ href, children, title, id }) =>
        href ? (
          <a
            href={href}
            title={title}
            id={id}
            target={href.startsWith('#') ? undefined : '_blank'}
            rel={href.startsWith('#') ? undefined : 'noopener noreferrer'}
          >
            {children}
          </a>
        ) : (
          <span id={id}>{children}</span>
        ),
      img: ({ src, alt, title }) =>
        src && typeof src === 'string' && githubImage(src) ? (
          <img src={src} alt={alt ?? ''} title={title} loading="lazy" />
        ) : src ? (
          <a
            className="description-image-link"
            href={src}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ImageIcon size={15} aria-hidden="true" />
            {alt || 'View image attachment'}
          </a>
        ) : (
          <span>{alt}</span>
        ),
      table: ({ node, children }) => (
        <div
          className="description-table-scroll"
          data-source-start={focused ? node?.position?.start.offset : undefined}
          data-source-end={focused ? node?.position?.end.offset : undefined}
        >
          <table>{children}</table>
        </div>
      ),
      pre: ({ node, children }) => {
        const code = node?.children.find(
          (child) => child.type === 'element' && child.tagName === 'code',
        )
        const classes = code?.type === 'element' ? code.properties.className : undefined
        const language = Array.isArray(classes)
          ? classes
              .map(String)
              .find((name) => name.startsWith('language-'))
              ?.slice(9)
          : undefined
        return (
          <div
            data-source-start={focused ? node?.position?.start.offset : undefined}
            data-source-end={focused ? node?.position?.end.offset : undefined}
          >
            <DescriptionCode text={plainText(code)} language={language}>
              {children}
            </DescriptionCode>
          </div>
        )
      },
    }),
    [focused],
  )
  if (!pull.description.trim())
    return <p className="pull-description-empty">No description provided.</p>
  return (
    <article className="pull-description" ref={article}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, descriptionSchema]]}
        urlTransform={(url) => descriptionUrl(url, pull)}
        components={components}
      >
        {pull.description}
      </Markdown>
    </article>
  )
}
