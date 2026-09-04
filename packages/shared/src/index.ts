/**
 * Request/response contracts shared by the API and the web client.
 *
 * Defined once with zod so the server validates and the client types from the
 * same source. The legacy had no contract at all: ~90 screens were rendered
 * server-side and only two endpoints ever emitted JSON, both by string
 * concatenation (izariam/controllers/actions.php:1512, :1544).
 */

import { z } from 'zod'

import { slotSchema } from './primitives.js'

export * from './primitives.js'

/**
 * Registration input, deliberately shallow.
 *
 * Length and format are decided in exactly one place -- `register()` in the
 * API -- because those are the failures a player actually sees and the start
 * page has a translated message for each code it can return (`name_length`,
 * `password_length`, `invalid_email`). While zod owned the rules it rejected
 * first with a generic `invalid_input`, which reached the page as a raw code
 * and left `register()`'s own checks unreachable.
 *
 * The bounds here are only a guard against pathological input reaching argon2;
 * they sit far outside the real limits.
 */
export const registerSchema = z.object({
  login: z.string().max(200),
  password: z.string().max(200),
  email: z.string().max(400),
})
export type RegisterRequest = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().max(400),
})
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().max(200),
})
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>


export const buildSchema = z.object({
  townId: z.number().int().positive(),
  slot: slotSchema,
  type: z.number().int().min(1).max(26),
})
export type BuildRequest = z.infer<typeof buildSchema>

export const demolishSchema = z.object({
  townId: z.number().int().positive(),
  slot: slotSchema,
})

export const researchSchema = z.object({
  branch: z.number().int().min(1).max(4),
  node: z.number().int().min(1).max(16),
})

export const recruitSchema = z.object({
  townId: z.number().int().positive(),
  units: z.array(
    z.object({
      unitType: z.number().int().min(1).max(23),
      count: z.number().int().positive(),
    }),
  ),
})

export const workersSchema = z.object({
  townId: z.number().int().positive(),
  role: z.enum(['workers', 'tradegood', 'scientists']),
  count: z.number().int().min(0),
})

/** Viewport for the isometric world map. */
export const mapAreaSchema = z.object({
  xMin: z.number().int(),
  xMax: z.number().int(),
  yMin: z.number().int(),
  yMax: z.number().int(),
})
export type MapAreaRequest = z.infer<typeof mapAreaSchema>

export interface MapIsland {
  id: number
  name: string
  x: number
  y: number
  type: number
  tradeResource: number
  wonder: number
  townCount: number
}

export * from './actions.js'

export interface ApiError {
  error: string
  detail?: unknown
}
