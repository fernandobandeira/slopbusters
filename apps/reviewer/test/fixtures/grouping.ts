import type { PullRequest } from '../../shared/domain/types'

export function fixtureGroupingReply(pull: PullRequest) {
  return {
    questions: [],
    rest: [
      {
        title: 'Fixture changes',
        lane: 'implementation',
        reason: 'These changes carry out an existing decision.',
        hunkIds: pull.files.flatMap((file) => file.hunks.map(({ id }) => id)),
      },
    ],
  }
}
