export function graphRef(name = 'main', requiredApprovals = 2) {
  return {
    name,
    branchProtectionRule: {
      requiredApprovingReviewCount: requiredApprovals,
      requiresApprovingReviews: true,
      requiresCodeOwnerReviews: false,
      requiredStatusCheckContexts: ['build'],
    },
    rules: { nodes: [], pageInfo: { hasNextPage: false } },
  }
}
export function graphPull(number = 1) {
  return {
    reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    number,
    headRefOid: 'head',
    baseRefOid: 'base',
    state: 'OPEN',
    isDraft: false,
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED',
    stack: null,
    baseRef: graphRef(),
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: 'SUCCESS',
              contexts: {
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'build',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                    detailsUrl: 'https://github.com/example/project/actions/runs/1',
                    required: true,
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        },
      ],
    },
    latestReviews: {
      nodes: [
        {
          state: 'APPROVED',
          author: { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    reviewRequests: { nodes: [], pageInfo: { hasNextPage: false } },
  }
}
