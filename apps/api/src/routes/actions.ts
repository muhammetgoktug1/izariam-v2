/**
 * The 37 mutation endpoints, replacing izariam/controllers/actions.php.
 *
 * Every one follows the same shape:
 *
 *   transaction -> advance(hooks) -> validate -> rules call -> persist
 *
 * The tick runs *before* the action, not after, because the legacy did the same
 * thing and it is load-bearing: `Update_Player` ran in the Game controller's
 * constructor, so an action always saw resources accrued up to `now`. Building
 * something you could only just afford depends on it.
 *
 * A rejection is 409 with the rules' own reason string. Not 400: the request
 * was well-formed, the world just said no. 400 is reserved for a body that
 * failed its schema, and 404 for a town that is not the caller's.
 *
 * Every handler runs inside one transaction, so a rejection rolls back the tick
 * as well. That costs a little accrued production on a refused action -- the
 * next request recomputes it from `last_update`, so nothing is lost.
 */

import {
  abolishColony,
  activateMiracle,
  abortBuildings,
  abortFleet,
  abortShips,
  abortUnits,
  armyEdit,
  army,
  branchOffice,
  build,
  buyPremium,
  changeCapital,
  changePassword as changePasswordRule,
  colonize,
  deleteUserMessages,
  demolition,
  derive,
  donateWonder,
  doResearch,
  emptyBranchOffice,
  ESPIONAGE_MISSION,
  fleet,
  hurryConstruction,
  leaveConstructionList,
  readUserMessage,
  renameLogin,
  renameTown,
  RESOURCES,
  resolveEspionage,
  resources as resourcesRule,
  sendUserMessage,
  setCitySelectMode,
  skipTutorial,
  spyes,
  tavern,
  tradeRoute,
  trade as tradeRule,
  transport,
  transporter,
  tutorials,
  upgrade,
  workers,
  type ActionIntent,
  type ActionResult,
  type BranchOfficeState,
  type DerivedTown,
  type PlayerState,
  type Resource,
  type Resources,
  type TownState,
  type UnitCounts,
} from '@izariam/rules'
import type { ActionContext as BuildingContext } from '@izariam/rules/actions/building'
import type { ActionContext as TradeContext } from '@izariam/rules/actions/trade'
import {
  abolishColonySchema,
  abortBuildingsSchema,
  activateMiracleSchema,
  abortFleetSchema,
  abortUnitsSchema,
  armyEditSchema,
  branchOfficeSchema,
  buildActionSchema,
  buyPremiumSchema,
  changeCapitalSchema,
  changePasswordSchema,
  citySelectModeSchema,
  colonizeFoundSchema,
  colonizeRelocateSchema,
  deleteMessagesSchema,
  demolishActionSchema,
  donateWonderSchema,
  doResearchSchema,
  espionageSchema,
  hurryConstructionSchema,
  leaveConstructionSchema,
  readMessageSchema,
  recruitActionSchema,
  renameLoginSchema,
  renameTownSchema,
  resourcesDonationSchema,
  sendMessageSchema,
  skipTutorialSchema,
  spyBuySchema,
  spyReturnSchema,
  spySendSchema,
  tavernSchema,
  tradeRouteCreateSchema,
  tradeRouteDeleteSchema,
  tradeRouteEditSchema,
  tradeSchema,
  transporterSchema,
  transportSchema,
  tutorialsSchema,
  upgradeSchema,
  workersActionSchema,
} from '@izariam/shared'
import argon2 from 'argon2'
import { Router } from 'express'
import type { Request, Response } from 'express'
import type { ZodType } from 'zod'

import { transaction } from '../db.js'
import { advance, persist, type Advanced } from '../state/advance.js'
import {
  espionageIntel,
  islandFaith,
  lockIslandWonder,
  loginTaken,
  mailbox,
  missionRoute,
  saveIslandWonder,
  sendSpyTarget,
  spyTarget,
  townExists,
  userExists,
} from '../state/foreign.js'
import { allocateTownId, transientIds } from '../state/ids.js'
import { loadIslandIntoGraph, type Queryable } from '../state/load.js'

export const actionsRouter: Router = Router()

/** What a handler gets. `intents` is where it adds work for the persist step. */
interface Ctx<T> {
  client: Queryable
  body: T
  state: PlayerState
  advanced: Advanced
  now: number
  userId: number
  intents: ActionIntent[]
  /** Fresh derive() over the ticked state. */
  derived: ReturnType<typeof derive>
  /** Anything the handler wants merged into the JSON response. Most actions
   *  answer `{ok:true}` and let the client refetch /api/state; espionage is
   *  the exception, because its report exists only in that one response. */
  reply: Record<string, unknown>
}

/** Rules that need a town also need its derived stats and the town itself. */
interface TownCtx<T> extends Ctx<T> {
  town: TownState
  townDerived: DerivedTown
}

class Rejected extends Error {
  constructor(
    readonly reason: string,
    readonly status = 409,
  ) {
    super(reason)
  }
}

function reject(reason: string, status = 409): never {
  throw new Rejected(reason, status)
}

/**
 * The one flow. `handler` mutates the state and returns the rules' verdict; a
 * false verdict aborts the transaction, so a refused action leaves no trace.
 */
function action<T>(
  schema: ZodType<T>,
  handler: (ctx: Ctx<T>) => ActionResult | Promise<ActionResult>,
) {
  return async (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', detail: parsed.error.issues })
      return
    }

    const userId = req.userId!
    try {
      const payload = await transaction(async (client) => {
        const advanced = await advance(client, userId)
        if (!advanced) reject('no_player', 404)

        const intents: ActionIntent[] = []
        const ctx: Ctx<T> = {
          client,
          body: parsed.data,
          state: advanced.state,
          advanced,
          now: advanced.now,
          userId,
          intents,
          derived: derive(advanced.state, advanced.now),
          reply: {},
        }

        const result = await handler(ctx)
        if (!result.ok) reject(result.reason)

        advanced.messages.push(...result.messages)
        intents.push(...(result.intents ?? []))
        await persist(client, advanced, intents)
        return { ok: true as const, ...ctx.reply }
      })
      res.json(payload)
    } catch (err) {
      if (err instanceof Rejected) {
        res.status(err.status).json({ error: err.reason })
        return
      }
      throw err
    }
  }
}

/** Same, for the 24 actions that operate on one of the caller's towns. */
function townAction<T extends { townId: number }>(
  schema: ZodType<T>,
  handler: (ctx: TownCtx<T>) => ActionResult | Promise<ActionResult>,
) {
  return action<T>(schema, async (ctx) => {
    const town = ctx.state.towns.find((t) => t.id === ctx.body.townId)
    // 404 rather than 409: a town that is not yours is indistinguishable from
    // one that does not exist, and saying which would leak the map.
    if (!town) reject('unknown_town', 404)
    const townDerived = ctx.derived.towns[town.id]
    // derive() drops a town whose town hall is level 0 (a colony still in
    // transit), exactly as Load_Player did. Actions against it have nothing to
    // price themselves from.
    if (!townDerived) reject('town_not_active')
    ctx.state.user.currentTownId = town.id
    return handler({ ...ctx, town, townDerived })
  })
}

function buildingCtx<T>(ctx: TownCtx<T>): BuildingContext {
  return { state: ctx.state, town: ctx.town, derived: ctx.townDerived, now: ctx.now }
}

/** trade.ts wants an id allocator; ids.ts explains why it hands out negatives. */
function tradeCtx<T>(ctx: Ctx<T>): TradeContext {
  return { now: ctx.now, allocateId: transientIds() }
}

/** Fill the five resources the rules index unconditionally. */
function fullResources(partial: Partial<Record<Resource, number>> | undefined): Resources {
  const out = {} as Resources
  for (const r of RESOURCES) out[r] = partial?.[r] ?? 0
  return out
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

actionsRouter.post(
  '/actions/build',
  townAction(buildActionSchema, (c) => build(buildingCtx(c), c.body.slot, c.body.type)),
)

actionsRouter.post(
  '/actions/upgrade',
  townAction(upgradeSchema, (c) => upgrade(buildingCtx(c), c.body.slot)),
)

/**
 * Ambrosia for build time. The building is not finished here -- `advance()` has
 * already ticked, so all this writes is a rewound `buildStartedAt`, and the
 * next tick completes it with the score bump, the town message and the queue's
 * deferred payment that come with a normal completion (rules/hurry.ts).
 */
actionsRouter.post(
  '/actions/hurryConstruction',
  townAction(hurryConstructionSchema, (c) =>
    hurryConstruction(buildingCtx(c), c.body.slot, c.body.mode),
  ),
)

actionsRouter.post(
  '/actions/demolish',
  townAction(demolishActionSchema, (c) => demolition(buildingCtx(c), c.body.slot)),
)

/**
 * Call an island's miracle.
 *
 * The island's wonder, its monument level and its faith are all read here
 * rather than taken from the request: faith is a sum over every town on the
 * island including other players', the monument is raised by all of them, and
 * a client that could state its own faith could state 100%.
 */
actionsRouter.post(
  '/actions/activateMiracle',
  action(activateMiracleSchema, async (c) => {
    const island = c.state.islands[c.body.islandId]
    // Read rather than taken from `state.islands`, which was loaded before any
    // neighbour's donation could have landed: the monument level decides how
    // strong the miracle is, so it has to be the current one.
    const row = (
      await c.client.query('select wonder, wonder_level from islands where id = $1', [
        c.body.islandId,
      ])
    ).rows[0]
    const wonder = Number(row?.wonder ?? island?.wonder ?? 0)
    const wonderLevel = Number(row?.wonder_level ?? island?.wonderLevel ?? 1)
    const faith = (await islandFaith(c.client, [c.body.islandId])).get(c.body.islandId)
    return activateMiracle(
      { state: c.state, now: c.now },
      { islandId: c.body.islandId, wonder, faith: faith?.faith ?? 0, wonderLevel },
    )
  }),
)

actionsRouter.post(
  '/actions/abortBuildings',
  townAction(abortBuildingsSchema, (c) => abortBuildings(buildingCtx(c), c.body.townId)),
)

actionsRouter.post(
  '/actions/leaveConstructionList',
  townAction(leaveConstructionSchema, (c) => leaveConstructionList(buildingCtx(c), c.body.index)),
)

/**
 * Note for callers: `workers` applies each block in turn and stops at the first
 * one that fails (building.ts:485-527), so `ok:false` does NOT mean nothing
 * changed. The transaction rolls the partial work back, which is stricter than
 * the legacy -- there the earlier blocks stuck.
 */
actionsRouter.post(
  '/actions/workers',
  townAction(workersActionSchema, (c) =>
    workers(buildingCtx(c), {
      screen: c.body.screen,
      slot: c.body.slot,
      resourceWorkers: c.body.resourceWorkers,
      tradegoodWorkers: c.body.tradegoodWorkers,
      scientists: c.body.scientists,
      priests: c.body.priests,
    }),
  ),
)

actionsRouter.post(
  '/actions/resources',
  townAction(resourcesDonationSchema, (c) =>
    resourcesRule(buildingCtx(c), c.body.kind, c.body.islandId, c.body.donation),
  ),
)

/**
 * Donate a luxury good to the island's monument.
 *
 * The island row is locked first, for the length of the request's transaction.
 * `advance()` already holds the user row, so the order is always user then
 * island; and the counters the rules decide the new level from are then the
 * ones nobody else can be halfway through changing. Without it two donors both
 * read the same pre-upgrade totals, both see the last good land, and the
 * monument gains two levels for one level's worth of goods.
 *
 * The write goes back through `saveIslandWonder` while the lock is still held.
 * It cannot ride `savePlayerState`'s island UPDATE: that one is blind, and it
 * is the reason these six columns are excluded from it.
 */
actionsRouter.post(
  '/actions/donateWonder',
  townAction(donateWonderSchema, async (c) => {
    const locked = await lockIslandWonder(c.client, c.body.islandId)
    if (!locked) return { ok: false, reason: 'wonder_no_wonder' }

    // The in-memory island was loaded before the lock existed, so bring it up
    // to date before derive() or the response can read the stale numbers.
    const island = c.state.islands[c.body.islandId]
    if (island) {
      island.wonderLevel = locked.wonderLevel
      island.wonderDonated = { ...locked.donated }
    }

    const result = donateWonder(buildingCtx(c), {
      islandId: c.body.islandId,
      good: c.body.good,
      amount: c.body.amount,
      island: locked,
    })

    if (result.ok && result.island) {
      await saveIslandWonder(c.client, c.body.islandId, result.island)
      if (island) {
        island.wonderLevel = result.island.wonderLevel
        island.wonderDonated = { ...result.island.donated }
      }
    }
    return result
  }),
)

actionsRouter.post(
  '/actions/tavern',
  townAction(tavernSchema, (c) => tavern(buildingCtx(c), c.body.slot, c.body.amount)),
)

// ---------------------------------------------------------------------------
// Military
// ---------------------------------------------------------------------------

function counts(raw: Record<string, number>): UnitCounts {
  const out: UnitCounts = {}
  for (const [type, count] of Object.entries(raw)) out[Number(type)] = count
  return out
}

/**
 * Recruiting zero of everything still stamps `startedAt` (military.ts:262), so
 * a client that retries an empty form restarts the queue's clock. Faithful.
 */
actionsRouter.post(
  '/actions/army',
  townAction(recruitActionSchema, (c) => army(buildingCtx(c), c.body.slot, counts(c.body.counts))),
)

actionsRouter.post(
  '/actions/fleet',
  townAction(recruitActionSchema, (c) => fleet(buildingCtx(c), c.body.slot, counts(c.body.counts))),
)

/** armyEdit never rejects anything (military.ts:286); the schema is the guard. */
actionsRouter.post(
  '/actions/armyEdit',
  townAction(armyEditSchema, (c) => armyEdit(buildingCtx(c), counts(c.body.counts))),
)

actionsRouter.post(
  '/actions/abortUnits',
  townAction(abortUnitsSchema, (c) => abortUnits(buildingCtx(c))),
)

actionsRouter.post(
  '/actions/abortShips',
  townAction(abortUnitsSchema, (c) => abortShips(buildingCtx(c))),
)

actionsRouter.post(
  '/actions/spyes/buy',
  townAction(spyBuySchema, (c) => spyes(buildingCtx(c), { action: 'buy' })),
)

actionsRouter.post(
  '/actions/spyes/send',
  townAction(spySendSchema, async (c) => {
    const target = await sendSpyTarget(c.client, c.body.targetTownId)
    return spyes(buildingCtx(c), {
      action: 'send',
      islandId: c.body.islandId,
      target: target ?? null,
      // Negative, so savePlayerState INSERTs the row. See state/ids.ts.
      spyId: transientIds()(),
    })
  }),
)

actionsRouter.post(
  '/actions/spyes/return',
  townAction(spyReturnSchema, (c) =>
    spyes(buildingCtx(c), {
      action: 'return',
      spyId: c.body.spyId,
      fromTownId: c.body.fromTownId,
    }),
  ),
)

/**
 * Espionage is the one rule that does not return an ActionResult: it reports an
 * outcome, and a caught spy is a successful request with a bad result. Mapped
 * so a rejected *order* is a 409 and a failed *roll* is a 200 with the report.
 */
actionsRouter.post(
  '/actions/resolveEspionage',
  townAction(espionageSchema, async (c) => {
    const spy = c.state.spies.find((s) => s.id === c.body.spyId)
    if (!spy) reject('unknown_spy')
    if (spy.toTownId == null) reject('spy_has_no_target')

    const target = await spyTarget(c.client, spy.toTownId)
    if (!target) reject('unknown_target')
    const intel = await espionageIntel(c.client, spy.toTownId)
    if (!intel) reject('unknown_target')

    const result = resolveEspionage({
      actor: c.state,
      actingTownId: c.body.townId,
      spyId: c.body.spyId,
      mission: c.body.mission,
      target,
      intel,
      now: c.now,
      rng: Math.random,
    })
    if (!result.accepted) reject(result.rejection ?? 'espionage_rejected')

    // The report rides back on the response; the messages go through the
    // normal channel so the safehouse screen finds them next load.
    c.advanced.messages.push(...result.messages)
    // The report is the whole point of the request, so it rides back on the
    // response rather than only into spy_messages.
    c.reply.espionage = {
      outcome: result.outcome,
      risk: result.risk,
      roll: result.roll,
      goldSpent: result.goldSpent,
      report: result.report,
    }
    return { ok: true, messages: [] }
  }),
)

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

actionsRouter.post(
  '/actions/branchOffice',
  townAction(branchOfficeSchema, (c) => {
    const office: BranchOfficeState = c.town.branchOffice ?? emptyBranchOffice()
    c.town.branchOffice = office
    // All five rows or none: the legacy required them posted together, and a
    // row whose TradeType field was missing arrived as 0.
    const offers = c.body.offers
      ? (Object.fromEntries(
          RESOURCES.map((r) => [
            r,
            {
              direction: c.body.offers?.[r]?.direction ?? 0,
              count: c.body.offers?.[r]?.count ?? 0,
              price: c.body.offers?.[r]?.price ?? 0,
            },
          ]),
        ) as NonNullable<Parameters<typeof branchOffice>[3]['offers']>)
      : undefined
    return branchOffice(c.state, c.town, office, { search: c.body.search, offers }, tradeCtx(c))
  }),
)

actionsRouter.post(
  '/actions/trade',
  townAction(tradeSchema, async (c) =>
    tradeRule(
      c.state,
      c.town,
      {
        targetTownId: c.body.targetTownId,
        targetExists: await townExists(c.client, c.body.targetTownId),
        type: c.body.type,
        counts: c.body.counts,
        prices: c.body.prices,
        transporters: c.body.transporters,
      },
      tradeCtx(c),
    ),
  ),
)

/**
 * Eight distinct failures collapse into one `trade_fleet_no_freight` code
 * (trade.ts:594) and the cargo is neither floored nor clamped. Both are the
 * legacy's; the schema does the flooring the rules do not.
 */
actionsRouter.post(
  '/actions/transport',
  townAction(transportSchema, async (c) =>
    transport(
      c.state,
      c.town,
      {
        islandId: c.body.islandId,
        targetTownId: c.body.targetTownId,
        targetExists: await townExists(c.client, c.body.targetTownId),
        cargo: c.body.cargo,
        transporters: c.body.transporters,
      },
      tradeCtx(c),
    ),
  ),
)

actionsRouter.post(
  '/actions/transporter',
  townAction(transporterSchema, (c) => transporter(c.state, tradeCtx(c))),
)

/**
 * SECURITY: `abortFleet` has no ownership check of its own (trade.ts:707) and
 * `load.ts` puts *incoming* foreign fleets into `state.missions` too, so
 * without the guard below any player could recall anyone's fleet by id.
 */
actionsRouter.post(
  '/actions/abortFleet',
  action(abortFleetSchema, async (c) => {
    const mission = c.state.missions.find((m) => m.id === c.body.missionId)
    if (!mission) reject('unknown_mission', 404)
    if (mission.userId !== c.userId) reject('not_your_fleet', 403)

    const route = await missionRoute(c.client, mission.id)
    return abortFleet(c.state, { missionId: mission.id, route }, tradeCtx(c))
  }),
)

actionsRouter.post(
  '/actions/tradeRoute/create',
  action(tradeRouteCreateSchema, (c) => tradeRoute(c.state, { ...c.body }, tradeCtx(c))),
)

actionsRouter.post(
  '/actions/tradeRoute/edit',
  action(tradeRouteEditSchema, (c) =>
    tradeRoute(c.state, { ...c.body, save: true }, tradeCtx(c)),
  ),
)

actionsRouter.post(
  '/actions/tradeRoute/delete',
  action(tradeRouteDeleteSchema, (c) =>
    tradeRoute(c.state, { deleteId: c.body.deleteId }, tradeCtx(c)),
  ),
)

// ---------------------------------------------------------------------------
// Colony
// ---------------------------------------------------------------------------

actionsRouter.post(
  '/actions/colonize/found',
  townAction(colonizeFoundSchema, async (c) => {
    // The target island is in the graph only if the player already has a town
    // or a mission there -- which a first colony on a new island, by
    // definition, does not. Load it or the rules refuse `island_not_loaded`.
    await loadIslandIntoGraph(c.client, c.state, c.body.islandId)
    // The town id has to be real before the action runs: the colonisation
    // mission points at it and it claims an island slot. The mission id does
    // not -- nothing references it until it is written.
    const newTownId = await allocateTownId(c.client)
    return colonize(
      c.state,
      {
        mode: 'found',
        islandId: c.body.islandId,
        slot: c.body.slot,
        send: fullResources(c.body.send),
        transports: c.body.transports,
        newTownId,
        newMissionId: transientIds()(),
      },
      { now: c.now },
    )
  }),
)

actionsRouter.post(
  '/actions/colonize/relocate',
  townAction(colonizeRelocateSchema, async (c) => {
    await loadIslandIntoGraph(c.client, c.state, c.body.islandId)
    return colonize(
      c.state,
      { mode: 'relocate', islandId: c.body.islandId, slot: c.body.slot, townId: c.body.townId },
      { now: c.now },
    )
  }),
)

actionsRouter.post(
  '/actions/abolishColony',
  action(abolishColonySchema, (c) => abolishColony(c.state)),
)

actionsRouter.post(
  '/actions/changeCapital',
  action(changeCapitalSchema, (c) => changeCapital(c.state, c.body.townId)),
)

actionsRouter.post(
  '/actions/doResearch',
  action(doResearchSchema, (c) => doResearch(c.state, c.body.way, c.body.id)),
)

actionsRouter.post(
  '/actions/buyPremium',
  action(buyPremiumSchema, (c) => buyPremium(c.state, c.body.type, { now: c.now })),
)

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

actionsRouter.post(
  '/actions/renameLogin',
  action(renameLoginSchema, async (c) =>
    renameLogin(c.state, c.body.login, await loginTaken(c.client, c.body.login, c.userId)),
  ),
)

/**
 * The rules only signal intent here -- they must not know what a hash is
 * (colony.ts:700) -- so the three checks and the write both live in the route.
 *
 * The legacy's two "not empty" guards compared *md5 digests* against '' and so
 * never fired, which let an empty password through. Not reproduced: that is a
 * security hole rather than a balance decision.
 */
actionsRouter.post(
  '/actions/changePassword',
  action(changePasswordSchema, async (c) => {
    if (c.body.newPassword.length < 8) reject('password_too_short')
    if (c.body.newPassword !== c.body.confirmPassword) reject('password_mismatch')
    if (c.body.newPassword === c.body.oldPassword) reject('password_unchanged')

    const { rows } = await c.client.query('select password_hash from users where id = $1', [
      c.userId,
    ])
    const hash = rows[0]?.password_hash
    if (!hash || !(await argon2.verify(String(hash), c.body.oldPassword))) {
      reject('bad_credentials', 403)
    }

    await c.client.query(
      'update users set password_hash = $2, legacy_password_md5 = null where id = $1',
      [c.userId, await argon2.hash(c.body.newPassword, { type: argon2.argon2id })],
    )
    return changePasswordRule(c.state)
  }),
)

actionsRouter.post(
  '/actions/setCitySelectMode',
  action(citySelectModeSchema, (c) => setCitySelectMode(c.state, c.state.user.options, c.body.mode)),
)

actionsRouter.post(
  '/actions/skipTutorial',
  action(skipTutorialSchema, (c) => skipTutorial(c.state)),
)

actionsRouter.post(
  '/actions/tutorials',
  action(tutorialsSchema, (c) => tutorials(c.state, c.body.action, c.body.id)),
)

actionsRouter.post(
  '/actions/renameTown',
  townAction(renameTownSchema, (c) => renameTown(c.state, c.body.name)),
)

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

actionsRouter.post(
  '/actions/sendUserMessage',
  action(sendMessageSchema, async (c) =>
    sendUserMessage(
      c.state,
      {
        toUserId: c.body.toUserId,
        type: c.body.type,
        text: c.body.text,
        recipientExists: await userExists(c.client, c.body.toUserId),
      },
      { now: c.now },
    ),
  ),
)

actionsRouter.post(
  '/actions/readUserMessage',
  action(readMessageSchema, async (c) =>
    readUserMessage(c.state, await mailbox(c.client, c.userId), c.body.id, { now: c.now }),
  ),
)

actionsRouter.post(
  '/actions/deleteUserMessages',
  action(deleteMessagesSchema, async (c) =>
    deleteUserMessages(
      c.state,
      await mailbox(c.client, c.userId),
      { id: c.body.id, selection: c.body.selection },
      { now: c.now },
    ),
  ),
)

