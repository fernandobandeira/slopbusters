import type { ReactNode, Ref } from 'react'

export function AppTitleBar({
  children,
  contentRef,
  navigation = 'app',
}: {
  children?: ReactNode
  contentRef: Ref<HTMLDivElement>
  navigation?: 'app' | 'review' | 'none'
}) {
  return (
    <div className="app-titlebar" data-navigation={navigation}>
      <div className="app-titlebar-brand">
        <img src="/slopbusters.png" alt="" width={22} height={22} />
        <strong>Slopbusters</strong>
      </div>
      <div className="app-titlebar-content" ref={contentRef}>
        {children}
      </div>
    </div>
  )
}
