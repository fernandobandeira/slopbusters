export function onBrowserWake(check: () => void) {
  const wake = () => {
    if (document.visibilityState === 'visible') check()
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)
  return () => {
    document.removeEventListener('visibilitychange', wake)
    window.removeEventListener('focus', wake)
    window.removeEventListener('online', wake)
  }
}
