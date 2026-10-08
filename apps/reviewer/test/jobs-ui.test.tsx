// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TicketMarkdown } from '../src/components/TicketMarkdown'
import { JobsQuestions } from '../src/features/jobs/JobsQuestions'
import { required } from './fixtures/bob'
import { fixtureDescription, fixtureJobsAdvice } from './fixtures/tickets'

afterEach(cleanup)

describe('Jobs questions', () => {
  it('folds only the questions the owner answered', () => {
    const onFold = vi.fn()
    const questions = [
      ...fixtureJobsAdvice().questions,
      { ...required(fixtureJobsAdvice().questions[0]), id: 'later', topic: 'Reminders' },
    ]
    render(<JobsQuestions questions={questions} disabled={false} onFold={onFold} />)

    fireEvent.click(required(screen.getAllByRole('button', { name: 'Operations, by hand' })[0]))
    fireEvent.click(screen.getByRole('button', { name: /Fold 1 answer into the ticket/ }))

    expect(onFold).toHaveBeenCalledWith([
      {
        questionId: 'late-transfer',
        question: required(questions[0]).question,
        answer: 'Operations, by hand',
      },
    ])
  })
  it('says so when nothing is left to decide', () => {
    render(<JobsQuestions questions={[]} disabled={false} onFold={vi.fn()} />)
    expect(screen.getByText(/Every decision in this ticket is settled/)).toBeTruthy()
  })
})

describe('ticket Markdown', () => {
  it('renders Linear collapses as disclosure sections and drops scripts', () => {
    const { container } = render(
      <TicketMarkdown
        markdown={`${fixtureDescription}\n\n<script>alert(1)</script>`}
        label="Issue description"
      />,
    )
    expect(container.querySelector('details summary')?.textContent).toBe(
      'What happens to a late transfer?',
    )
    expect(container.querySelector('script')).toBeNull()
  })
})
