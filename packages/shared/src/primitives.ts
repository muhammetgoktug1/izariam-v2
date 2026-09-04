/**
 * The few schemas both index.ts and actions.ts need.
 *
 * They live apart from either because `index.ts` re-exports `actions.ts`, so
 * anything actions.ts imports back from index.ts closes a cycle -- and with ESM
 * live bindings that cycle is not a warning, it is a
 * `ReferenceError: Cannot access 'resourceSchema' before initialization` at
 * the first import.
 */

import { z } from 'zod'

export const resourceSchema = z.enum(['wood', 'wine', 'marble', 'crystal', 'sulfur'])
export type Resource = z.infer<typeof resourceSchema>

/** Board slots run 0..14; only even ones are offered at registration. */
export const slotSchema = z.number().int().min(0).max(14)
