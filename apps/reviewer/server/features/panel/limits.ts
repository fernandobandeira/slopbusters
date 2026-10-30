export const MAX_PANEL_REVIEWERS = 8
/** How many panel reviewers run at the same time on one PR. */
export const PANEL_REVIEWER_CONCURRENCY = 3
/**
 * How many PRs panels review at the same time. Each runs its own reviewers and grounding, so
 * more PRs queue until one finishes.
 */
export const PANEL_PULL_CONCURRENCY = 2
/** How many PR snapshots a panel loads at the same time before its seats start. */
export const PANEL_PREPARE_CONCURRENCY = 3
/** The most other stack layers a panel loads as evidence; GitHub stacks rarely run longer. */
export const MAX_PANEL_STACK_LAYERS = 12
/** How much of the other layers' diffs a seat's prompt carries; past it, only their file lists. */
export const MAX_PANEL_LAYER_EVIDENCE_CHARS = 300_000
/** How much of a teammate's earlier comments on the PR its seat's prompt carries. */
export const MAX_PANEL_HISTORY_CHARS = 60_000
/**
 * How many seat findings one grounding round checks per PR, across every seat; the rest wait as
 * deferred. A starting value: lower it if a maximum-sized grounding reply does not fit a provider.
 */
export const MAX_GROUNDING_SOURCES = 40
/** Grounding turns before the debate stops and keeps what the two models did agree on. */
export const MAX_GROUNDING_TURNS = 6
/**
 * One grounding turn checks every selected source against the code, so a strong model reading a
 * large repository needs far longer than a single review pass.
 */
export const GROUNDING_TURN_TIMEOUT_MS = 20 * 60 * 1000
/** A panel seat reads a whole PR, and its skill may ask for a deep pass through the repository. */
export const PANEL_REVIEW_TIMEOUT_MS = 15 * 60 * 1000
/** A planning pass checks one finding. */
export const PLANNING_TIMEOUT_MS = 10 * 60 * 1000
