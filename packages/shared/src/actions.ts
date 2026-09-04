/**
 * Request contracts for the 37 mutation endpoints.
 *
 * These are the only validation the game has. The legacy ran POST fields
 * straight through `floor()` and into the model, which is why several actions
 * accept values they were never meant to: `armyEdit` never rejects anything and
 * will happily set a garrison to a negative count (military.ts:286), and
 * `transport` does not floor or clamp its cargo (trade.ts:594). Those are
 * faithful ports of real defects, so the schema is where they get stopped --
 * not by changing the rules.
 *
 * Where a bound is the legacy's own, it is written here as the legacy's: board
 * slots 0..14, unit ids 1..23, research branches 1..4.
 */

import { z } from 'zod'

import { resourceSchema, slotSchema } from './primitives.js'

/** A quantity a player typed. Non-negative, whole, and bounded well below the
 *  point where float arithmetic in the rules starts losing integers. */
const qty = z.number().int().min(0).max(1_000_000_000)

const townId = z.number().int().positive()
const positiveId = z.number().int().positive()

const perResource = z.partialRecord(resourceSchema, qty)

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export const buildActionSchema = z.object({
  townId,
  slot: slotSchema,
  /** 26 building types; 0 is "empty ground" and cannot be built. */
  type: z.number().int().min(1).max(26),
})

export const upgradeSchema = z.object({ townId, slot: slotSchema })
export const demolishActionSchema = z.object({ townId, slot: slotSchema })
export const abortBuildingsSchema = z.object({ townId })

/**
 * Ambrosia for build time -- the one action here with no legacy counterpart
 * (see rules/hurry.ts).
 *
 * `slot` is not redundant with "whatever is at the head of the queue": the head
 * can finish between the render and the click and let the next entry slide up,
 * and paying to rush a building you did not choose is not undoable.
 */
export const hurryConstructionSchema = z.object({
  townId,
  slot: slotSchema,
  /** `half` removes half of the remaining time, `all` removes it. */
  mode: z.enum(['half', 'all']),
})

/** Index into the construction list, not a board slot. */
export const leaveConstructionSchema = z.object({
  townId,
  index: z.number().int().min(0).max(10),
})

export const workersActionSchema = z.object({
  townId,
  /** The screen the form was posted from; only the tutorial step reads it. */
  screen: z.string().max(40).default(''),
  slot: z.number().int().min(0).default(0),
  resourceWorkers: qty.optional(),
  tradegoodWorkers: qty.optional(),
  scientists: qty.optional(),
  /** Temple priests. No legacy counterpart -- see rules/temple.ts. */
  priests: qty.optional(),
})

/**
 * Calling an island's miracle.
 *
 * Only the island travels: which wonder stands there, and how much of the
 * island believes, are both read on the server. A client that could name its
 * own faith could name 100%.
 */
export const activateMiracleSchema = z.object({
  islandId: positiveId,
})

export const resourcesDonationSchema = z.object({
  townId,
  kind: z.enum(['resource', 'tradegood']),
  islandId: positiveId,
  donation: qty,
})

/**
 * Donating a luxury good to the island's monument.
 *
 * The good travels but nothing about the island does: which luxury it produces
 * itself, what the monument is standing at and how much has already been given
 * are all read from the row the server locks.
 */
export const donateWonderSchema = z.object({
  townId,
  islandId: positiveId,
  good: z.enum(['wine', 'marble', 'crystal', 'sulfur']),
  amount: qty,
})

export const tavernSchema = z.object({
  townId,
  slot: slotSchema,
  amount: qty,
})

// ---------------------------------------------------------------------------
// Military
// ---------------------------------------------------------------------------

/** unitType -> count. Recruitment counts are bounded; garrison edits are not
 *  bounded by the rules at all, so the bound here is the only one there is. */
const unitCounts = z.record(
  z.string().regex(/^([1-9]|1[0-9]|2[0-3])$/),
  z.number().int().min(0).max(1_000_000),
)

export const recruitActionSchema = z.object({
  townId,
  slot: slotSchema,
  counts: unitCounts,
})

export const armyEditSchema = z.object({ townId, counts: unitCounts })
export const abortUnitsSchema = z.object({ townId })

export const spyBuySchema = z.object({ townId })
export const spySendSchema = z.object({
  townId,
  /** 0 means "the island this town sits on" (actions.php:1632-1635). */
  islandId: z.number().int().min(0),
  targetTownId: positiveId,
})
export const spyReturnSchema = z.object({
  townId,
  spyId: positiveId,
  fromTownId: positiveId,
})

export const espionageSchema = z.object({
  /** The town whose safehouse level offsets the risk: the selected town, which
   *  the legacy read separately from the spy's origin (actions.php:892). */
  townId,
  spyId: positiveId,
  /** 3..10, see ESPIONAGE_MISSION. */
  mission: z.number().int().min(3).max(10),
})

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

export const branchOfficeSchema = z.object({
  townId,
  search: z
    .object({
      /** 1 = looking for offers to buy from, 0 = buyers to sell to. */
      type: z.number().int().min(0).max(1),
      /** 0..4, indexing RESOURCE_BY_TRADE_RESOURCE. */
      resource: z.number().int().min(0).max(4),
      radius: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
  /** All five rows or none: the legacy requires them posted together
   *  (actions.php:294). A missing TradeType arrives as 0 in PHP, so
   *  `direction` defaults to 0 rather than to the stored value. */
  offers: z
    .partialRecord(
      resourceSchema,
      z.object({
        direction: z.number().int().min(0).max(1).default(0),
        count: qty,
        price: qty,
      }),
    )
    .optional(),
})

export const tradeSchema = z.object({
  townId,
  targetTownId: positiveId,
  /** 1 = buy from the offer, 0 = sell into it. */
  type: z.number().int().min(0).max(1),
  counts: perResource,
  prices: perResource,
  transporters: z.number().int().min(0).max(10_000),
})

export const transportSchema = z.object({
  townId,
  islandId: positiveId,
  targetTownId: positiveId,
  cargo: perResource,
  transporters: z.number().int().min(0).max(10_000),
})

export const transporterSchema = z.object({ townId })

export const abortFleetSchema = z.object({ missionId: positiveId })

export const tradeRouteCreateSchema = z.object({
  fromTownId: townId,
  toTownId: townId,
  /** 0..4, indexing RESOURCE_BY_TRADE_RESOURCE. */
  tradegood: z.number().int().min(0).max(4),
  /** Hour of the day the route fires. The legacy accepts 24 (trade.ts). */
  hour: z.number().int().min(0).max(24),
  count: qty,
  timezoneOffset: z.number().int().min(-50400).max(50400).optional(),
})

export const tradeRouteEditSchema = tradeRouteCreateSchema.extend({
  routeId: positiveId,
})

export const tradeRouteDeleteSchema = z.object({ deleteId: positiveId })

// ---------------------------------------------------------------------------
// Colony, account, mail
// ---------------------------------------------------------------------------

export const colonizeFoundSchema = z.object({
  townId,
  islandId: positiveId,
  /** Islands have 17 town slots. */
  slot: z.number().int().min(0).max(16),
  send: perResource.optional(),
  transports: z.number().int().min(0).max(10_000),
})

export const colonizeRelocateSchema = z.object({
  islandId: positiveId,
  slot: z.number().int().min(0).max(16),
  townId,
})

export const abolishColonySchema = z.object({})
export const changeCapitalSchema = z.object({ townId })

export const doResearchSchema = z.object({
  /** The legacy calls a research branch a "way". */
  way: z.number().int().min(1).max(4),
  id: z.number().int().min(1).max(16),
})

export const buyPremiumSchema = z.object({
  type: z.enum(['account', 'wood', 'wine', 'marble', 'crystal', 'sulfur', 'capacity']),
})

export const renameLoginSchema = z.object({ login: z.string().min(1).max(30) })

export const changePasswordSchema = z.object({
  oldPassword: z.string().max(200),
  newPassword: z.string().max(200),
  confirmPassword: z.string().max(200),
})

export const citySelectModeSchema = z.object({ mode: z.number().int().min(0).max(2) })

export const skipTutorialSchema = z.object({})
export const tutorialsSchema = z.object({
  action: z.enum(['next', 'set']),
  id: z.number().int().min(0).max(999).default(0),
})

export const renameTownSchema = z.object({ townId, name: z.string().min(1).max(30) })

export const sendMessageSchema = z.object({
  toUserId: positiveId,
  /** Validated as `> 0 and <= 1`, so 1 is the only value the game accepts. */
  type: z.number().int(),
  text: z.string().max(10_000),
})

export const readMessageSchema = z.object({ id: positiveId })

export const deleteMessagesSchema = z.object({
  id: positiveId.optional(),
  /** The checkbox grid: message id -> whatever the form posted. */
  selection: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
})
