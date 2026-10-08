import { useState } from 'react'
import { Button } from '~/components/ui/button'
import type { JobsAnswer, JobsQuestion } from '../../../shared/domain/jobs'
import { TicketMarkdown } from '../../components/TicketMarkdown'

/** The owner answers what Jobs could not settle; unanswered questions stay open in the ticket. */
export function JobsQuestions({
  questions,
  disabled,
  onFold,
}: {
  questions: JobsQuestion[]
  disabled: boolean
  onFold: (answers: JobsAnswer[]) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (!questions.length)
    return <p className="muted">No open questions. Every decision in this ticket is settled.</p>
  const ready = questions
    .filter((question) => answers[question.id]?.trim())
    .map((question) => ({
      questionId: question.id,
      question: question.question,
      answer: (answers[question.id] ?? '').trim(),
    }))
  function set(id: string, value: string) {
    setAnswers((previous) => ({ ...previous, [id]: value }))
  }
  return (
    <form
      className="jobs-questions"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready.length) onFold(ready)
      }}
    >
      {questions.map((question) => (
        <fieldset key={question.id} className="jobs-question">
          <legend>{question.topic}</legend>
          <TicketMarkdown markdown={question.question} label={question.topic} />
          <p className="muted jobs-question-meta">
            Answered by {question.owner} · Blocks {question.blocks}
          </p>
          {question.options.length > 0 && (
            <div className="jobs-options" aria-label="Likely answers">
              {question.options.map((option) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={answers[question.id] === option}
                  onClick={() => {
                    set(question.id, option)
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <textarea
            aria-label={`Answer: ${question.topic}`}
            placeholder="Your answer, or leave it for the owner"
            value={answers[question.id] ?? ''}
            onChange={(event) => {
              set(question.id, event.target.value)
            }}
            rows={2}
          />
        </fieldset>
      ))}
      <div className="jobs-actions">
        <Button type="submit" disabled={disabled || !ready.length}>
          Fold {ready.length || ''} answer{ready.length === 1 ? '' : 's'} into the ticket
        </Button>
        <span className="muted">Skipped questions stay visible in Open questions.</span>
      </div>
    </form>
  )
}
