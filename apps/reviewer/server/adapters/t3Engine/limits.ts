export const PROVIDER_TIMEOUT_MS = 300_000
export const T3_ENGINE_REQUEST_TIMEOUT_MS = 10_000
export const T3_ENGINE_PAIR_TIMEOUT_MS = 60_000
/** Preparing a pull request worktree can fetch the PR head, so engine calls get longer. */
export const T3_ENGINE_CALL_TIMEOUT_MS = 180_000
export const T3_ENGINE_TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000
/**
 * The RPC client pings the engine every 5 seconds, and an engine busy for a few seconds stops
 * answering. Like T3 Code's own client, allow this long without any frame before dropping it.
 */
export const T3_ENGINE_PING_TIMEOUT_MS = 15_000
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
/**
 * How long the engine may take to open a provider session for a turn it accepted. A turn that is
 * still not running by then never will be, so it fails now instead of at its full timeout.
 */
export const T3_ENGINE_TURN_START_TIMEOUT_MS = 2 * 60_000
/**
 * Times a structured turn follows its thread again on a new socket after the old one drops, as
 * when the computer sleeps through the ping timeout. The turn keeps running in the engine meanwhile.
 */
export const MAX_T3_ENGINE_TURN_REATTACHES = 3
/**
 * Pauses before a structured turn runs again after a transient failure, such as the engine
 * restarting under it or a provider at capacity; one more attempt per pause. The first gives a
 * restarted engine time to come up.
 */
export const TRANSIENT_TURN_RETRY_DELAYS_MS: readonly number[] = [20_000, 60_000]
/** Room left under the engine's message limit for anything it adds to a turn's input. */
export const T3_ENGINE_TURN_INPUT_MARGIN_CHARS = 4000
/** How much of a schema validation failure is quoted back to the agent and in errors. */
export const MAX_STRUCTURED_ERROR_CHARS = 2000
/** Times a structured turn's caller may send problems it found in the copy back to the agent. */
export const MAX_STRUCTURED_FOLLOW_UPS = 2
