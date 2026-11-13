import { Button } from '~/components/ui/button'
import { getMcpEndpoint } from '../../../shared/api/settings'
import { useApiQuery } from '../../lib/useApiQuery'
import { useClipboard } from '../../lib/useClipboard'

/** How a coding agent adds Slopbusters, so it can ask the panel for a review itself. */
export function CodingAgentSettings() {
  const endpoint = useApiQuery(getMcpEndpoint, {})
  const url = endpoint.data?.url
  const problem = endpoint.error ?? endpoint.data?.problem
  return (
    <section className="settings-section" aria-labelledby="coding-agents-title">
      <h2 id="coding-agents-title">Coding agents</h2>
      <p className="muted">
        Claude Code, Codex and other MCP clients can ask the panel to review a PR and read the
        grounded result, while Slopbusters is open. Add it to your agent once, then ask it for a
        Slopbusters panel review of a PR.
      </p>
      {problem && <p role="alert">{problem}</p>}
      {url && (
        <div className="agent-commands">
          <AgentCommand
            agent="Claude Code"
            command={`claude mcp add --transport http --scope user slopbusters ${url}`}
          />
          <AgentCommand agent="Codex" command={`codex mcp add slopbusters --url ${url}`} />
          <AgentCommand agent="Other MCP clients" command={url} />
        </div>
      )}
      {endpoint.data && !url && !problem && (
        <p className="muted">
          This run serves no agents. The desktop app does; a development server does when started
          with <code>SLOPBUSTERS_MCP_PORT</code>.
        </p>
      )}
    </section>
  )
}

function AgentCommand({ agent, command }: { agent: string; command: string }) {
  const clipboard = useClipboard()
  return (
    <div className="agent-command">
      <span>{agent}</span>
      <code>{command}</code>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Copy for ${agent}`}
        onClick={() => void clipboard.copy(command)}
      >
        {clipboard.state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
