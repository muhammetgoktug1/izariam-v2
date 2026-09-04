/**
 * Request contracts for the staff panel.
 *
 * Reached as `@izariam/shared/admin`, and deliberately **not** re-exported from
 * `index.ts`: the player client imports `@izariam/shared`, and a top-level
 * `z.object(...)` is not provably side-effect-free, so anything routed through
 * the barrel would very likely survive tree-shaking into the game bundle. A
 * subpath the player app never imports keeps the panel out of it structurally
 * rather than by hoping. (`@izariam/rules` splits `./espionage`, `./missions`
 * and the rest the same way.)
 *
 * Like `registerSchema`, the bounds here are guards against pathological input
 * reaching argon2 or Postgres -- the real length and format rules stay in
 * `register()`/`checkPassword()` so each failure keeps its own code.
 */

import { z } from 'zod'

export const adminLoginSchema = z.object({
  email: z.string().max(400),
  password: z.string().max(200),
})
export type AdminLoginRequest = z.infer<typeof adminLoginSchema>

// ---------------------------------------------------------------------------
// Panel users
// ---------------------------------------------------------------------------

export const adminUserCreateSchema = z.object({
  email: z.string().max(255),
  name: z.string().min(1).max(80),
  password: z.string().max(200),
  active: z.boolean().default(true),
})
export type AdminUserCreateRequest = z.infer<typeof adminUserCreateSchema>

export const adminUserUpdateSchema = z.object({
  email: z.string().max(255).optional(),
  name: z.string().min(1).max(80).optional(),
  /** Omitted or empty means "leave the password alone". */
  password: z.string().max(200).optional(),
  active: z.boolean().optional(),
})
export type AdminUserUpdateRequest = z.infer<typeof adminUserUpdateSchema>

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** The columns the list may be ordered by. A whitelist, because the value ends
 *  up in an ORDER BY that no parameter placeholder can carry. */
export const adminPlayerSortSchema = z.enum([
  'id',
  'login',
  'created',
  'lastVisit',
  'banned',
  'towns',
])
export type AdminPlayerSort = z.infer<typeof adminPlayerSortSchema>

export const adminPlayerListSchema = z.object({
  q: z.string().max(100).default(''),
  page: z.coerce.number().int().min(0).default(0),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  sort: adminPlayerSortSchema.default('id'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})
export type AdminPlayerListRequest = z.infer<typeof adminPlayerListSchema>

export const adminPlayerCreateSchema = z.object({
  login: z.string().max(200),
  password: z.string().max(200),
  email: z.string().max(400),
})
export type AdminPlayerCreateRequest = z.infer<typeof adminPlayerCreateSchema>

/** Identity only. Resources, gold, ambrosia and research points are not absent
 *  because they are forbidden -- they are granted through
 *  `adminResourceGrantSchema` below, which goes the long way round: load the
 *  player, run the tick, mutate the state, persist. A value poked into the
 *  columns from here would be recomputed from `towns.last_update` and written
 *  back over by the next `persist()`. */
export const adminPlayerUpdateSchema = z.object({
  login: z.string().max(200).optional(),
  email: z.string().max(400).optional(),
})
export type AdminPlayerUpdateRequest = z.infer<typeof adminPlayerUpdateSchema>

/**
 * A ban is a duration, never a wall-clock instant.
 *
 * `blocked_until` is `timestamptz` and `verifyLogin` compares it against
 * `Date.now()`; a zone-less ISO string from a Turkish date picker would be a
 * three-hour error. Seconds go straight into `make_interval(secs => $n)`.
 *
 * "Permanent" is a flag rather than a huge number so the client never has to
 * name the sentinel instant -- and it must stay a *finite* instant on the
 * server, because a timestamptz `infinity` arrives in node-postgres as the JS
 * number `Infinity`, whose `new Date(...)` is Invalid Date, which reads to
 * `verifyLogin` as an elapsed ban and clears it.
 */
export const adminBanSchema = z
  .object({
    permanent: z.boolean().default(false),
    /** Up to ten years; anything longer is what `permanent` is for. */
    seconds: z
      .number()
      .int()
      .min(60)
      .max(10 * 365 * 24 * 60 * 60)
      .optional(),
    reason: z.string().max(500).default(''),
  })
  .refine((v) => v.permanent || v.seconds !== undefined, {
    message: 'seconds_required',
  })
export type AdminBanRequest = z.infer<typeof adminBanSchema>

// ---------------------------------------------------------------------------
// Resource grants
// ---------------------------------------------------------------------------

/**
 * The five town resources, in the order every screen lists them.
 *
 * Declared here rather than imported from `@izariam/rules`: the panel must not
 * pull the rules engine (and the gamedata catalogue behind it) into its bundle.
 * `apps/api/src/admin/resources.ts` asserts at compile time that this is the
 * same set the engine has.
 */
export const GRANT_RESOURCES = ['wood', 'wine', 'marble', 'crystal', 'sulfur'] as const
export type GrantResource = (typeof GRANT_RESOURCES)[number]

/** Account-wide values, none of which live on a town. */
export const GRANT_ACCOUNT_FIELDS = ['gold', 'ambrosia', 'researchPoints', 'transports'] as const
export type GrantAccountField = (typeof GRANT_ACCOUNT_FIELDS)[number]

/**
 * `numeric(20,6)` columns: at 1e9 with six decimals a double is already at 16
 * significant digits, which is its limit. Far above any reachable warehouse --
 * a level-50 one holds 401,500.
 */
const QTY_MAX = 1_000_000_000

/**
 * `ambrosia` and `transports` are `integer` columns. A grant past 2^31 would
 * abort the transaction with a raw Postgres error and a 500 instead of a clean
 * 400, so they get their own, tighter ceiling.
 */
const INT_MAX = 100_000_000

/**
 * One field of a grant: how to write it, and what to write.
 *
 * A discriminated union rather than `{ mode: enum, value: number }` so that
 * "a `set` cannot be negative" is a type, not a `.refine` -- and so zod reports
 * the problem at `town.wood.value`, which is what the panel shows.
 *
 * An omitted field means "leave this alone". `{ mode: 'set', value: 0 }` is a
 * deliberate wipe, and must stay expressible.
 */
const field = (max: number) =>
  z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('add'), value: z.number().int().min(-max).max(max) }),
    // A `set` below zero can only ever clamp to zero: it is a typo, not an
    // intent, so it is refused here rather than silently floored.
    z.object({ mode: z.literal('set'), value: z.number().int().min(0).max(max) }),
  ])

export type GrantField = { mode: 'add' | 'set'; value: number }

export const adminResourceGrantSchema = z.object({
  /** Which of the player's towns the town fields apply to. */
  townIds: z.array(z.number().int().positive()).max(200).default([]),
  town: z
    .object({
      wood: field(QTY_MAX).optional(),
      wine: field(QTY_MAX).optional(),
      marble: field(QTY_MAX).optional(),
      crystal: field(QTY_MAX).optional(),
      sulfur: field(QTY_MAX).optional(),
    })
    .default({}),
  account: z
    .object({
      gold: field(QTY_MAX).optional(),
      ambrosia: field(INT_MAX).optional(),
      researchPoints: field(QTY_MAX).optional(),
      transports: field(INT_MAX).optional(),
    })
    .default({}),
  /** Free text, straight into the audit log. Never shown to the player. */
  note: z.string().max(500).default(''),
})
export type AdminResourceGrantRequest = z.infer<typeof adminResourceGrantSchema>

export interface GrantOutcome {
  value: number
  /** Hit the warehouse ceiling. */
  clamped: boolean
  /** Hit the floor at zero. */
  floored: boolean
}

/**
 * What a field's new value is.
 *
 * Lives in the shared package because the panel's "1.500 → 11.500" preview and
 * the server's write have to agree to the unit; two implementations of this
 * would disagree the first time somebody changed one of them.
 *
 * `ceiling` is the town's warehouse capacity, and `Infinity` for the
 * account-wide fields, which have no cap. The floor at zero is not cosmetic:
 * the tick zeroes a negative gold on its next pass (tick.ts:110), and nothing
 * at all guards ambrosia, research points or transports -- a negative there
 * would persist and break every `>=` check in the rules.
 */
export function applyGrant(current: number, f: GrantField, ceiling = Infinity): GrantOutcome {
  const raw = f.mode === 'set' ? f.value : current + f.value
  if (raw > ceiling) return { value: ceiling, clamped: true, floored: false }
  if (raw < 0) return { value: 0, clamped: false, floored: true }
  return { value: raw, clamped: false, floored: false }
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Every action the panel writes.
 *
 * A closed set, so the filter is a select rather than a text box -- and because
 * the panel types its Turkish label map as `Record<AdminAuditAction, string>`,
 * adding one here fails the panel's build until it has a label. A Turkish-only
 * tool showing `player.grant_resources` to a moderator is the failure that
 * prevents.
 *
 * The *response* keeps `action` as a plain string: a row written before an
 * action was renamed must still render.
 */
export const adminAuditActionSchema = z.enum([
  'admin.create',
  'admin.update',
  'admin.delete',
  'player.create',
  'player.update',
  'player.ban',
  'player.unban',
  'player.reset_link',
  'player.grant_resources',
])
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>

/**
 * Dates travel as epoch seconds, never as `YYYY-MM-DD` -- the same rule
 * `adminBanSchema` follows. `created_at` is `timestamptz`, the panel renders it
 * with `Intl` in the browser's zone, and the API container runs in UTC: a
 * zone-less date would move the day boundary by three hours, so "bugün" would
 * quietly drop its first three hours.
 */
export const adminAuditListSchema = z.object({
  /** '' = every action. */
  action: adminAuditActionSchema.or(z.literal('')).default(''),
  targetType: z.enum(['player', 'admin']).or(z.literal('')).default(''),
  /** The acting admin. 0 = anyone. */
  adminId: z.coerce.number().int().min(0).default(0),
  /** 0 = any target. */
  targetId: z.coerce.number().int().min(0).default(0),
  /** Inclusive lower bound, exclusive upper bound. 0 = unbounded. */
  from: z.coerce.number().int().min(0).default(0),
  to: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(0).default(0),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
})
export type AdminAuditListRequest = z.infer<typeof adminAuditListSchema>
