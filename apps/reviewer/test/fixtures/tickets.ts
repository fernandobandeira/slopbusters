import type { JobsAdvice } from '../../shared/domain/jobs'
import type { Ticket } from '../../shared/domain/tickets'

export const fixtureDescription = `When a clinic books without a card, it wants the deposit to arrive by transfer.

## Done means
- Transfers accumulate until the deposit is reached

>>> What happens to a late transfer?
Operations records it.
>>>`

export function fixtureTicket(changes: Partial<Ticket> = {}): Ticket {
  return {
    id: 'issue-uuid-1',
    identifier: 'SCH-760',
    title: 'Collect deposits by transfer',
    url: 'https://linear.app/clinic/issue/SCH-760/collect-deposits-by-transfer',
    state: { name: 'Todo', type: 'unstarted' },
    priority: 2,
    updatedAt: '2026-10-01T10:00:00.000Z',
    assignee: 'Avery Example',
    team: { key: 'SCH', name: 'Scheduling' },
    project: null,
    labels: ['ready-for-agent'],
    parent: 'SCH-750',
    pullUrls: [],
    description: fixtureDescription,
    branchName: 'avery/sch-760-collect-deposits',
    parentTicket: {
      identifier: 'SCH-750',
      title: 'Deposits without a card',
      url: 'https://linear.app/clinic/issue/SCH-750/deposits',
      state: { name: 'In Progress', type: 'started' },
      description: 'Parent job.',
    },
    children: [],
    pulls: [],
    ...changes,
  }
}

export function fixtureJobsAdvice(changes: Partial<JobsAdvice> = {}): JobsAdvice {
  return {
    verdict: 'needs-work',
    summary: 'The job is clear; who handles late transfers is not.',
    findings: [
      {
        id: 'late-owner',
        rule: 'questions',
        severity: 'important',
        title: 'Name who follows up on late transfers',
        body: 'The collapse says operations records it but not who acts.',
        reference: 'Operations records it.',
      },
    ],
    questions: [
      {
        id: 'late-transfer',
        topic: 'Late transfers',
        question: 'Who refunds a transfer that arrives after the booking is confirmed?',
        owner: 'operations',
        blocks: 'The Done means bullet about late transfers',
        options: ['Operations, by hand', 'Nobody; it is kept as credit'],
      },
    ],
    resolved: [],
    revisedTitle: 'Clinics collect appointment deposits by bank transfer',
    revisedDescription: `${fixtureDescription}\n\n## Open questions\n- **Late transfers:** who refunds them? Needs operations`,
    unverified: [],
    limitations: [],
    disagreements: [],
    ...changes,
  }
}
