import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { ThemePicker } from './ThemePicker'

export function SettingsPage({ inboxUrl }: { inboxUrl: string }) {
  return (
    <div className="settings-content">
      <Link className="back-to-inbox" to={inboxUrl}>
        <ArrowLeft size={14} /> Back to homepage
      </Link>
      <h1>Settings</h1>
      <section className="settings-section" aria-labelledby="appearance-title">
        <h2 id="appearance-title">Appearance</h2>
        <p className="muted">Choose the colors used throughout the app and in code diffs.</p>
        <ThemePicker />
      </section>
    </div>
  )
}
