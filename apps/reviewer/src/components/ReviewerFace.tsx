import { useState } from 'react'
import { initials } from '../../shared/domain/teammates'
import './reviewerFace.css'

/** A reviewer's face, or their initials when there is no image or it fails to load. */
export function ReviewerFace({
  name,
  src,
  size = 28,
  label,
}: {
  name: string
  src?: string
  size?: number
  /** Announce the face; without it the face is decoration beside the name. */
  label?: string
}) {
  const [failed, setFailed] = useState<string>()
  const style = { width: size, height: size }
  if (!src || failed === src)
    return (
      <span
        className="reviewer-face reviewer-face-initials"
        style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.38)) }}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        title={label}
      >
        {initials(name)}
      </span>
    )
  return (
    <img
      className="reviewer-face"
      src={src}
      style={style}
      alt={label ?? ''}
      title={label}
      onError={() => {
        setFailed(src)
      }}
    />
  )
}
