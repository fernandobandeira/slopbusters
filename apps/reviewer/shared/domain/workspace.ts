export interface ReviewWorkspaceInfo {
  sha: string
  status: 'preparing' | 'ready' | 'failed' | 'absent'
  directory?: string
  error?: string
  warnings: string[]
}

export interface LocalReviewCheckout extends ReviewWorkspaceInfo {
  owner: string
  repo: string
}
