/** How much of the units' patches the split prompt carries; the models read the rest with Git. */
export const MAX_SPLIT_PROMPT_PATCH_CHARS = 240_000
/** Turns the two models take cutting and reviewing a stack before the split stops. */
export const MAX_SPLIT_TURNS = 8
export const SPLIT_PROVIDER_TIMEOUT_MS = 15 * 60 * 1000
