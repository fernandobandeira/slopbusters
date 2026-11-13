/** The most open layers one stack review covers; the panel reads as many as stack evidence. */
export const MAX_STACK_REVIEW_LAYERS = 12
/**
 * How many characters of layers and entries the cross-layer pass reads. A full panel round on
 * one layer grounds at most 40 entries of about 700 characters each; this fits eleven layers'
 * current rounds with room to spare, about 50,000 tokens, leaving the model room for the debate's
 * current result and its history. Earlier rounds and skipped entries go first past it.
 */
export const MAX_STACK_PASS_INPUT_CHARS = 200_000
/**
 * Cross-layer turns before the debate stops and keeps its last valid result: the first model
 * builds it, the second corrects it, and each approves once, so one round of correction fits.
 */
export const MAX_STACK_PASS_TURNS = 4
/** A cross-layer turn reads the entries, not the repository, so it needs less than grounding. */
export const STACK_PASS_TURN_TIMEOUT_MS = 10 * 60 * 1000
/** How often a stack review looks at the panels it waits for. */
export const STACK_REVIEW_POLL_MS = 2000
