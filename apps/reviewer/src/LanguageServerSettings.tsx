import { useEffect, useState } from 'react'
import type { LanguageServerConfig, LanguageServerStatus } from '../shared/languageServers'
import { api, message } from './api'

export function LanguageServerSettings() {
  const [servers, setServers] = useState<LanguageServerStatus[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void api<LanguageServerStatus[]>('/language-servers', { signal: controller.signal })
      .then(setServers)
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(message(failure)) })
    return () => controller.abort()
  }, [])
  function change(index: number, value: Partial<LanguageServerConfig>) {
    setSaved(false)
    setServers((current) => current.map((server, candidate) => candidate === index ? { ...server, ...value } : server))
  }
  async function save() {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const configuration = servers.map(({ language, extensions, command, args }) => ({ language, extensions, command, args }))
      setServers(await api<LanguageServerStatus[]>('/language-servers', { method: 'PUT', body: JSON.stringify(configuration) }))
      setSaved(true)
    } catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }
  return (
    <section className="settings-section" aria-labelledby="source-navigation-title">
      <h2 id="source-navigation-title">Source navigation</h2>
      <p className="muted">
        Go to definition and Find references use installed language servers. JavaScript and
        TypeScript are included in the app. Other languages use syntax matches when their server
        is unavailable. Servers read temporary copies of the saved PR revision.
      </p>
      {error && <p role="alert">{error}</p>}
      {!servers.length && !error && <p role="status">Checking language servers…</p>}
      <div className="language-server-list">
        {servers.map((server, index) => (
          <details key={index} className="language-server-item">
            <summary>
              <span>{server.language.replaceAll('_', ' ')}</span>
              <span className="muted">{server.available ? 'Available' : server.command ? 'Not found' : 'Disabled'}</span>
            </summary>
            <p className="muted">{server.detail}</p>
            <fieldset disabled={busy}>
              <label>
                Language ID
                <input value={server.language} onChange={(event) => change(index, { language: event.target.value })} />
              </label>
              <label>
                File extensions (comma separated)
                <input value={server.extensions.join(',')} onChange={(event) => change(index, { extensions: event.target.value.split(',').map((extension) => extension.trim()) })} />
              </label>
              <label>
                Server command or absolute path
                <input value={server.command} placeholder="Leave empty to disable" onChange={(event) => change(index, { command: event.target.value })} />
              </label>
              <label>
                Arguments (one per line)
                <textarea rows={3} value={server.args.join('\n')} onChange={(event) => change(index, { args: event.target.value ? event.target.value.split('\n') : [] })} />
              </label>
            </fieldset>
            <p className="muted">Use a server that communicates over standard input/output. Arguments are passed directly; shell quoting is unnecessary.</p>
          </details>
        ))}
      </div>
      <div className="language-server-actions">
        <button type="button" disabled={busy} onClick={() => {
          setSaved(false)
          setServers((current) => [...current, { language: '', extensions: [], command: '', args: [], available: false, detail: 'Configure an installed server for another language.' }])
        }}>Add language</button>
        <button type="button" disabled={busy || !servers.length} onClick={() => void save()}>{busy ? 'Saving…' : 'Save language servers'}</button>
        {saved && <span role="status">Saved</span>}
      </div>
    </section>
  )
}
