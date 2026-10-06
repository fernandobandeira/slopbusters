import { z } from 'zod'
import { SessionMarkdown } from '~/components/chat/SessionMarkdown'

const resultSchema = z.object({
  summary: z.string().optional(),
  reasoning: z.string().optional(),
  issues: z.array(z.string()).optional(),
})

export function SessionResult({ text }: { text: string }) {
  let summary: z.infer<typeof resultSchema> | undefined
  try {
    summary = resultSchema.safeParse(JSON.parse(text)).data
  } catch {
    /* Preserve raw output when it is not a structured result. */
  }
  return (
    <article className="session-message">
      <strong>Result</strong>
      {(summary?.summary || summary?.reasoning) && (
        <SessionMarkdown text={summary.summary || summary.reasoning || ''} />
      )}
      {summary?.issues?.map((issue, index) => (
        <SessionMarkdown key={index} text={issue} />
      ))}
      <details className="session-tool">
        <summary>Structured output</summary>
        <pre>{text}</pre>
      </details>
    </article>
  )
}
