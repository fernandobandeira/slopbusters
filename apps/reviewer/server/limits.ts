export const DEFAULT_API_PORT = 4311
export const HTTP_BODY_LIMIT = '1mb'
export const MAX_FILE_BYTES = 512 * 1024
export const MAX_FILE_CACHE_BYTES = 16 * 1024 * 1024
export const MAX_SOURCE_CACHE_BYTES = 32 * 1024 * 1024
export const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024
export const GIT_TIMEOUT_MS = 120_000
export const STATUS_TTL_MS = 10_000
export const INBOX_TTL_MS = 15_000
export const STACK_TTL_MS = 30_000
export const JOB_RETENTION_MS = 60 * 60 * 1000
export const VIRTUAL_ROOT = '/review'
export const MAX_NAVIGATION_TARGETS = 500
export const MAX_NAVIGATION_FILES = 120
export const MAX_NAVIGATION_BYTES = 8 * 1024 * 1024
export const NAVIGATION_TIMEOUT_MS = 30_000

export const MAX_PROJECT_FILE_BYTES = 2 * 1024 * 1024

export const MAX_COMMAND_OUTPUT_BYTES = 24 * 1024 * 1024
export const COMMAND_TIMEOUT_MS = 60_000
export const NETWORK_RETRY_DELAYS_MS = [1000, 3000]
export const PROCESS_TERMINATION_MS = 1000
export const MAX_STDERR_CHARS = 4000
export const MAX_SYMBOL_SOURCE_CHARS = 500_000
export const SYNTAX_TIMEOUT_MICROS = 100_000
export const MAX_SYNTAX_DEPTH = 100
export const SOURCE_WORKSPACE_TIMEOUT_MS = 60_000
export const PROVIDER_TIMEOUT_MS = 300_000
export const LSP_INITIALIZE_TIMEOUT_MS = 45_000
export const LSP_INDEX_TIMEOUT_MS = 25_000
export const LSP_INDEX_POLL_MS = 150
export const LSP_IDLE_MS = 120_000
export const MAX_IDLE_LANGUAGE_SESSIONS = 3
export const TOOL_STATUS_TIMEOUT_MS = 10_000
export const TOOL_VERSION_TIMEOUT_MS = 5000
export const T3_ENGINE_REQUEST_TIMEOUT_MS = 10_000
export const T3_ENGINE_PAIR_TIMEOUT_MS = 60_000
/** Preparing a pull request worktree can fetch the PR head, so engine calls get longer. */
export const T3_ENGINE_CALL_TIMEOUT_MS = 180_000
export const T3_ENGINE_TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000
/** An engine socket no call has used for this long is closed; the next call opens another. */
export const T3_ENGINE_IDLE_SOCKET_MS = 5 * 60_000
/** The bundled engine runs its migrations on first start. */
export const T3_ENGINE_START_TIMEOUT_MS = 60_000
export const T3_ENGINE_START_POLL_MS = 250
/** The bundled engine stops its provider sessions and flushes its database before exiting. */
export const T3_ENGINE_STOP_TIMEOUT_MS = 10_000
/** The bundled engine clones a repository the first time a chat needs it. */
export const T3_ENGINE_CLONE_TIMEOUT_MS = 15 * 60_000
/** A structured turn's engine call outlives the turn so the interrupt can still be sent. */
export const T3_ENGINE_TURN_MARGIN_MS = 30_000
/** Copying a review checkout for one structured turn; a clone on APFS takes moments. */
export const INSPECTION_COPY_TIMEOUT_MS = 120_000
/** How much of a schema validation failure is quoted back to the agent and in errors. */
export const MAX_STRUCTURED_ERROR_CHARS = 2000
/** A Gandalf chat's first message carries the failed step of each failing check. */
export const MAX_CHAT_FAILURES = 8
export const MAX_CHAT_FAILURE_LOG_CHARACTERS = 6_000
export const CHAT_CONTEXT_TIMEOUT_MS = 60_000
export const MAX_DIFF_FILE_CACHE_ENTRIES = 60
export const MAX_SOURCE_FILE_CACHE_ENTRIES = 1000
export const MAX_SOURCE_TREE_CACHE_ENTRIES = 20
export const MAX_PULL_STATUS_CACHE_ENTRIES = 1000
export const MAX_REPOSITORY_CACHE_ENTRIES = 30
export const MAX_REVISION_CACHE_ENTRIES = 100
export const MAX_NAVIGATION_CACHE_ENTRIES = 40
export const MAX_GITHUB_BLOB_OUTPUT_BYTES = 4 * 1024 * 1024
export const MAX_GITHUB_TREE_OUTPUT_BYTES = 8 * 1024 * 1024
export const MAX_GITHUB_GRAPHQL_OUTPUT_BYTES = 16 * 1024 * 1024
export const MAX_WORKSPACE_STATUS_OUTPUT_BYTES = 1024 * 1024

export const MAX_SAVED_BOB_REVIEWS = 500

export const LINEAR_TIMEOUT_MS = 30_000
export const LINEAR_OAUTH_TIMEOUT_MS = 10 * 60 * 1000
export const MAX_LINEAR_RESPONSE_BYTES = 8 * 1024 * 1024
export const TICKET_TTL_MS = 30_000
export const TICKET_LINK_TTL_MS = 5 * 60 * 1000
export const MAX_TICKET_CACHE_ENTRIES = 200
export const MAX_TICKET_CONTEXT_CHARACTERS = 24_000
export const MAX_TICKET_RELATIVE_CHARACTERS = 8000
export const MAX_SAVED_JOBS_REVIEWS = 500

export const MAX_GANDALF_TURNS = 20
export const GANDALF_PROVIDER_TIMEOUT_MS = 15 * 60 * 1000
export const MAX_GANDALF_TIMEOUT_RETRIES = 1
export const MAX_GANDALF_BASE_RETRIES = 3
export const GANDALF_NETWORK_RETRY_DELAYS_MS = [15_000, 30_000, 60_000]
export const MAX_GANDALF_PULLS = 20
export const MAX_GANDALF_PROMPT_BYTES = 4 * 1024 * 1024

export const MAX_AGENT_EVENT_CHARS = 128 * 1024
export const MAX_AGENT_EVENT_PAGE = 200
export const MAX_AGENT_SESSIONS = 100
