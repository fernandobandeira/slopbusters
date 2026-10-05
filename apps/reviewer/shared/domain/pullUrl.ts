export function parsePullUrl(url: string) {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(
    url.trim(),
  )
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      'Enter a GitHub pull request URL, such as https://github.com/owner/repo/pull/123.',
    )
  }
  const number = Number(match[3])
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error('Enter a valid pull request number.')
  return { owner: match[1], repo: match[2], number }
}
