import type { ReactNode, Ref } from 'react'

export function AppTitleBar({
  children,
  contentRef,
}: {
  children?: ReactNode
  contentRef: Ref<HTMLDivElement>
}) {
  return (
    <div className="app-titlebar">
      <div className="app-titlebar-content" ref={contentRef}>
        {children}
      </div>
      <div className="app-titlebar-brand">
        <img src="/slopbusters.png" alt="" width={24} height={24} />
        <strong>Slopbusters</strong>
      </div>
    </div>
  )
}
