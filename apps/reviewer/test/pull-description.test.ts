import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PullDescription } from '../src/features/review/PullDescription'
import { fixturePull } from './fixtures/pull'

function render(description: string) {
  return renderToStaticMarkup(
    createElement(PullDescription, { pull: { ...fixturePull(), description } }),
  )
}

describe('PR Markdown descriptions', () => {
  it('renders GitHub Markdown structure rather than showing literal markup', () => {
    const result = render(
      '# Authorization\n\nReview **permissions** and `canEdit`.\n\n> Check tenant isolation.\n\n- [x] Add tests\n- [ ] Review docs\n\n| Role | Allowed |\n| --- | --- |\n| Editor | Yes |\n\n```typescript\nconst allowed = true\n```',
    )
    expect(result).toContain('<h1>Authorization</h1>')
    expect(result).toContain('<strong>permissions</strong>')
    expect(result).toContain('<blockquote>')
    expect(result).toContain('<table>')
    expect(result).toContain('type="checkbox"')
    expect(result).toContain('checked=""')
    expect(result).toContain('language-typescript')
    expect(result).toContain('Copy code block')
    expect(result).toContain('const allowed = true')
  })
  it('drops raw HTML and rejects executable links and image URLs', () => {
    const result = render(
      '<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n[Unsafe](javascript:alert%281%29)\n\n![Unsafe image](data:image/svg+xml;base64,PHN2Zz4=)\n\n[File](file:///etc/passwd)',
    )
    expect(result).not.toContain('<script')
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('data:image')
    expect(result).not.toContain('file:///')
    expect(result).not.toContain('href=""')
    expect(result).toContain('Unsafe')
  })
  it('opens relative repository links on the PR source branch and keeps footnotes local', () => {
    const result = render(
      '[Guide](docs/guide.md)\n\n[External](https://example.com/docs)\n\nFootnote[^1].\n\n[^1]: Useful context.',
    )
    expect(result).toContain(
      'href="https://github.com/review-room/example/blob/feat%2Fproject-permissions/docs/guide.md"',
    )
    expect(result).toContain('rel="noopener noreferrer"')
    expect(result).toContain('href="#pull-description-user-content-fn-1"')
    expect(result).toContain('id="pull-description-user-content-fn-1"')
    expect(result).toContain('id="pull-description-user-content-fnref-1"')
    expect(result).not.toContain('/pull/docs')
  })
  it('renders GitHub HTTPS image attachments inline and links images hosted elsewhere', () => {
    const result = render('![Screenshot](https://github.com/user-attachments/assets/example)')
    expect(result).toContain('src="https://github.com/user-attachments/assets/example"')
    expect(result).toContain('loading="lazy"')
    expect(result).toContain('Screenshot')
    const external = render('![Diagram](https://external.example/diagram.png)')
    expect(external).toContain('href="https://external.example/diagram.png"')
    expect(external).not.toContain('<img')
    expect(render('![Unsafe](https://githubusercontent.com.evil.example/image.png)')).not.toContain(
      '<img',
    )
  })
  it('preserves native collapsible sections while sanitizing their HTML and links', () => {
    const result = render(
      '<details open onclick="alert(1)"><summary>Implementation</summary>\n\n**Readable details**\n\n<script>alert(2)</script><style>body{display:none}</style><a href="javascript:alert(3)">Unsafe</a><img src="https://github.com/user-attachments/assets/image" onerror="alert(4)">\n\n</details>',
    )
    expect(result).toContain('<details open="">')
    expect(result).toContain('<summary>Implementation</summary>')
    expect(result).toContain('<strong>Readable details</strong>')
    expect(result).toContain('<img')
    expect(result).not.toMatch(/onclick|onerror|javascript:|<script|<style|alert\(/)
  })
})
