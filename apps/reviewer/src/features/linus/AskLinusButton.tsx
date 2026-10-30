import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { ReviewerFace } from '../../components/ReviewerFace'
import { personaFaceSrc } from '../../lib/reviewerFaces'

/** Ask Linus whether the picked PRs are packaged right: one PR each, or a stack. */
export function AskLinusButton({
  urls,
  busy = false,
  onStart,
}: {
  urls: string[]
  busy?: boolean
  onStart: (urls: string[]) => void
}) {
  const count = `${String(urls.length)} PR${urls.length === 1 ? '' : 's'}`
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || !urls.length}
      aria-label={`Ask Linus about ${count}`}
      title="PR scope and description"
      onClick={() => {
        onStart(urls)
      }}
    >
      {busy ? (
        <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
      ) : (
        <ReviewerFace name="Linus" src={personaFaceSrc('linus', 'neutral')} size={18} />
      )}
      {busy ? 'Starting…' : 'Ask Linus'}
    </Button>
  )
}
