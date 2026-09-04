/**
 * Persist a PlayerState back to Postgres.
 *
 * Runs as one statement batch inside the caller's transaction. The legacy had
 * no transactions at all -- registration alone performed seven sequential
 * writes with no rollback path (izariam/controllers/main.php:121-158), so a
 * mid-tick failure could leave resources debited with no mission row, or a
 * colony town holding an island slot nothing pointed at.
 *
 * Child collections (buildings, queues, garrisons, offers) are replaced
 * wholesale rather than diffed. They are bounded and tiny -- at most 15
 * building slots, 3 queue entries, 23 unit rows per town -- so a delete plus a
 * multi-row insert is both simpler and fewer round trips than computing a diff.
 */

import type { ActionIntent, PendingMessage, PlayerState, Resource } from '@izariam/rules'

import { RESOURCE_BY_TRADE_RESOURCE } from '@izariam/rules'

import type { Queryable } from './load.js'

/** Epoch seconds -> a value Postgres will read as timestamptz. */
function ts(v: number | null | undefined): Date | null {
  return v == null || v <= 0 ? null : new Date(v * 1000)
}

/** Builds "($1,$2),($3,$4)" and the flat parameter list for a multi-row insert. */
function tuples(rows: unknown[][], offset = 0): { text: string; params: unknown[] } {
  const params: unknown[] = []
  const chunks: string[] = []
  let n = offset
  for (const row of rows) {
    chunks.push(`(${row.map(() => `$${++n}`).join(',')})`)
    params.push(...row)
  }
  return { text: chunks.join(','), params }
}

async function replace(
  client: Queryable,
  table: string,
  columns: string[],
  ownerColumn: string,
  ownerId: number,
  rows: unknown[][],
) {
  await client.query(`delete from ${table} where ${ownerColumn} = $1`, [ownerId])
  if (rows.length === 0) return
  const { text, params } = tuples(rows)
  await client.query(`insert into ${table} (${columns.join(',')}) values ${text}`, params)
}

const RESOURCES: Resource[] = ['wood', 'wine', 'marble', 'crystal', 'sulfur']

/**
 * @param intents Structural changes the rules layer cannot perform itself --
 *   rows outside the player's own graph, or rows that must exist before the
 *   graph is written back. `foundColony` pushes its new town straight into
 *   `state.towns`, so its `createTown` intent has to INSERT before the town
 *   loop tries to UPDATE a row that is not there yet.
 */
export async function savePlayerState(
  client: Queryable,
  state: PlayerState,
  messages: PendingMessage[] = [],
  intents: ActionIntent[] = [],
) {
  const { user } = state

  await createTowns(client, state, intents)

  await client.query(
    `update users set
       login = $16, options_select = $17,
       gold = $2, ambrosia = $3, transports = $4, research_points = $5,
       tutorial_step = $6, current_town_id = $7, capital_town_id = $8,
       last_visit_at = now(),
       premium_account_until = $9, premium_wood_until = $10, premium_wine_until = $11,
       premium_marble_until = $12, premium_crystal_until = $13,
       premium_sulfur_until = $14, premium_capacity_until = $15
     where id = $1`,
    [
      user.id,
      user.gold,
      user.ambrosia,
      user.transports,
      user.research.points,
      user.tutorialStep,
      user.currentTownId,
      user.capitalTownId,
      ts(user.premium.account),
      ts(user.premium.wood),
      ts(user.premium.wine),
      ts(user.premium.marble),
      ts(user.premium.crystal),
      ts(user.premium.sulfur),
      ts(user.premium.capacity),
      // renameLogin and setCitySelectMode mutate the state in place; before
      // this both were accepted and then silently dropped.
      user.login,
      user.options.citySelect,
    ],
  )

  const scoreRows = Object.entries(user.scores).map(([category, value]) => [
    user.id,
    category,
    value,
  ])
  if (scoreRows.length > 0) {
    const { text, params } = tuples(scoreRows)
    await client.query(
      `insert into user_scores (user_id, category, value) values ${text}
       on conflict (user_id, category) do update set value = excluded.value`,
      params,
    )
  }

  /**
   * Miracles are upserted, never deleted: an expired one still has to be here
   * for its cooldown to be enforced, and the cooldown outlives the effect for
   * every wonder in the table (rules/temple.ts).
   */
  for (const miracle of user.miracles) {
    await client.query(
      `insert into miracle_activations (user_id, island_id, wonder, level, activated_at)
       values ($1, $2, $3, $4, to_timestamp($5))
       on conflict (user_id, island_id) do update
         set wonder = excluded.wonder, level = excluded.level,
             activated_at = excluded.activated_at`,
      [user.id, miracle.islandId, miracle.wonder, miracle.level, miracle.activatedAt],
    )
  }

  const researchRows = Object.entries(user.research.levels)
    .filter(([, level]) => level > 0)
    .map(([key, level]) => {
      const [branch, node] = key.split('_')
      return [user.id, Number(branch), Number(node), level]
    })
  if (researchRows.length > 0) {
    const { text, params } = tuples(researchRows)
    await client.query(
      `insert into user_research (user_id, branch, node, level) values ${text}
       on conflict (user_id, branch, node) do update set level = excluded.level`,
      params,
    )
  }

  for (const town of state.towns) {
    await client.query(
      // coalesce for the same reason as the INSERT: a colony founded this
      // request is already in state.towns with lastUpdate 0.
      `update towns set
         last_update = coalesce($2, now()), name = $3, island_id = $20, slot = $21,
         wood = $4, wine = $5, marble = $6, crystal = $7, sulfur = $8,
         peoples = $9, workers = $10, tradegood = $11, scientists = $12, templer = $13,
         spies = $14, spy_training_started_at = $15,
         workers_wood = $16, tradegood_wood = $17,
         action_points = $18, tavern_wine = $19, wonder_donated = $22
       where id = $1`,
      [
        town.id,
        ts(town.lastUpdate),
        town.name,
        ...RESOURCES.map((r) => town.resources[r]),
        town.peoples,
        town.workers,
        town.tradegood,
        town.scientists,
        town.templer,
        town.spies,
        ts(town.spyTrainingStartedAt),
        town.workersWood,
        town.tradegoodWood,
        town.actionPoints,
        town.tavernWine,
        // relocateTown moves the town between islands (colony.ts:301-302).
        // Without these two the move was accepted, the ambrosia charged, and
        // the town stayed exactly where it was.
        town.islandId,
        town.slot,
        town.wonderDonated,
      ],
    )

    const buildings = Object.entries(town.buildings.bySlot)
      .filter(([, b]) => b.type > 0 || b.level > 0)
      .map(([slot, b]) => [town.id, Number(slot), b.type, b.level])
    await replace(
      client,
      'town_buildings',
      ['town_id', 'slot', 'type', 'level'],
      'town_id',
      town.id,
      buildings,
    )

    // Only the head of the queue carries a start time, matching the legacy's
    // single build_start column.
    const buildQueue = town.buildQueue.map((e, i) => [
      town.id,
      i,
      e.slot,
      e.type,
      i === 0 ? ts(town.buildStartedAt) : null,
    ])
    await replace(
      client,
      'build_queue',
      ['town_id', 'position', 'slot', 'type', 'started_at'],
      'town_id',
      town.id,
      buildQueue,
    )

    const army = Object.entries(town.army)
      .filter(([, count]) => count > 0)
      .map(([unitType, count]) => [town.id, Number(unitType), count])
    await replace(
      client,
      'army_units',
      ['town_id', 'unit_type', 'count'],
      'town_id',
      town.id,
      army,
    )

    const unitQueue = [
      ...town.landQueue.map((e, i) => [
        town.id,
        'land',
        i,
        e.unitType,
        e.count,
        i === 0 ? ts(town.landQueueStartedAt) : null,
      ]),
      ...town.navalQueue.map((e, i) => [
        town.id,
        'naval',
        i,
        e.unitType,
        e.count,
        i === 0 ? ts(town.navalQueueStartedAt) : null,
      ]),
    ]
    await replace(
      client,
      'unit_queue',
      ['town_id', 'kind', 'position', 'unit_type', 'count', 'started_at'],
      'town_id',
      town.id,
      unitQueue,
    )

    const office = town.branchOffice
    if (office) {
      await client.query(
        `update towns set branch_search_direction = $2, branch_search_resource = $3,
           branch_search_radius = $4 where id = $1`,
        [
          town.id,
          office.searchType === 1 ? 'sell' : 'buy',
          RESOURCE_BY_TRADE_RESOURCE[office.searchResource] ?? 'wood',
          office.searchRadius,
        ],
      )
      // An offer of nothing is not an offer; the legacy kept the columns at
      // zero, the normalised table just has no row.
      const offers = RESOURCES.filter(
        (r) => office.offers[r].count > 0 || office.offers[r].price > 0,
      ).map((r) => [
        town.id,
        r,
        office.offers[r].direction === 1 ? 'sell' : 'buy',
        office.offers[r].count,
        office.offers[r].price,
      ])
      await replace(
        client,
        'branch_offers',
        ['town_id', 'resource', 'direction', 'count', 'price'],
        'town_id',
        town.id,
        offers,
      )
    }
  }

  // The six `wonder_*` columns are deliberately absent from this statement.
  // It is a blind write of a copy `loadPlayerState` read before any lock, on a
  // row shared by every player on the island -- adding them here would mean one
  // player's `GET /api/state` silently rolling back a neighbour's donation.
  // They are written only by POST /api/actions/donateWonder, which holds
  // `select … for update` on the row (routes/actions.ts).
  for (const island of Object.values(state.islands)) {
    await client.query(
      `update islands set
         wood_level = $2, trade_level = $3, wood_donated = $4, trade_donated = $5,
         wood_upgrade_started_at = $6, trade_upgrade_started_at = $7
       where id = $1`,
      [
        island.id,
        island.woodLevel,
        island.tradeLevel,
        island.woodDonated,
        island.tradeDonated,
        ts(island.woodUpgradeStartedAt),
        ts(island.tradeUpgradeStartedAt),
      ],
    )
  }

  await saveMissions(client, state)
  await saveTradeRoutes(client, state)
  await saveSpies(client, state)
  await saveMessages(client, messages)
  await applyIntents(client, state, intents)
}

/**
 * `createTown` only. It runs before everything else because the rules already
 * hold the new town in `state.towns` and the main loop would UPDATE a row that
 * does not exist.
 *
 * The id is not generated here: `foundColony` needs it up front to point the
 * colonisation mission and the island slot at the new town, so the caller
 * reserves it with `allocateTownId()` and the INSERT is explicit about it.
 */
async function createTowns(client: Queryable, state: PlayerState, intents: ActionIntent[]) {
  for (const intent of intents) {
    if (intent.kind !== 'createTown') continue
    const t = intent.town
    await client.query(
      // last_update falls back to now(): newColonyTown leaves it 0 because the
      // legacy inserted the row with four columns and took the rest from the
      // table defaults (actions.php:618). The colony has not accrued anything
      // yet, so "created just now" is the right stamp.
      `insert into towns (id, user_id, island_id, slot, name, last_update,
         wood, wine, marble, crystal, sulfur, peoples, workers, tradegood,
         scientists, templer, spies, workers_wood, tradegood_wood,
         action_points, tavern_wine)
       values ($1,$2,$3,$4,$5,coalesce($6, now()),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       on conflict (id) do nothing`,
      [
        t.id,
        t.userId,
        t.islandId,
        t.slot,
        t.name,
        ts(t.lastUpdate),
        ...RESOURCES.map((r) => t.resources[r]),
        t.peoples,
        t.workers,
        t.tradegood,
        t.scientists,
        t.templer,
        t.spies,
        t.workersWood,
        t.tradegoodWood,
        t.actionPoints,
        t.tavernWine,
      ],
    )
  }
}

/**
 * Everything else the rules asked for. Runs last, so the deletes cannot pull a
 * row out from under a write that is still to come.
 *
 * `changePassword` and `sendEmail` are deliberately not handled: the rules
 * engine must not know what a hash is (colony.ts:700) and there is no mailer,
 * so both stay the route's business.
 */
async function applyIntents(client: Queryable, state: PlayerState, intents: ActionIntent[]) {
  for (const intent of intents) {
    switch (intent.kind) {
      case 'createTown':
      case 'createMission':
        // createTown ran above; createMission is already in state.missions and
        // saveMissions inserted it from there.
        break

      case 'deleteTown':
        await client.query('delete from towns where id = $1 and user_id = $2', [
          intent.townId,
          state.user.id,
        ])
        break

      // Both cascade off towns, but abolishColony is the only caller and the
      // legacy issued them explicitly; keeping them means a future caller that
      // clears a garrison without dropping the town still works.
      case 'deleteArmy':
        await client.query('delete from army_units where town_id = $1', [intent.townId])
        break

      case 'deleteTownMessages':
        await client.query('delete from town_messages where town_id = $1', [intent.townId])
        break

      case 'renameLogin':
        // Written by the users UPDATE above from state.user.login.
        break

      case 'sendUserMessage': {
        const { rows } = await client.query(
          `insert into user_messages (from_user_id, kind, created_at, body)
           values ($1,$2,$3,$4) returning id`,
          [state.user.id, intent.type, ts(intent.date) ?? new Date(), intent.text],
        )
        const messageId = Number(rows[0].id)
        // Two rows, one per side: the addressee's inbox copy and the sender's
        // outbox copy. The legacy packed both sides into one row, which is why
        // it could never model a message with anything but two participants.
        await client.query(
          `insert into message_recipients (message_id, user_id, side)
           values ($1,$2,'to'), ($1,$3,'from')
           on conflict do nothing`,
          [messageId, intent.toUserId, state.user.id],
        )
        break
      }

      case 'markUserMessage': {
        const column =
          intent.field === 'checkedTo'
            ? 'read_at = $3'
            : 'deleted = true, read_at = coalesce(read_at, $3)'
        const side = intent.field === 'deletedFrom' ? 'from' : 'to'
        await client.query(
          `update message_recipients set ${column}
           where message_id = $1 and user_id = $2 and side = '${side}'`,
          [intent.messageId, state.user.id, ts(intent.at)],
        )
        break
      }

      case 'changePassword':
      case 'sendEmail':
        break
    }
  }
}

/**
 * Sync the player's in-flight fleets.
 *
 * A mission with id <= 0 has never been persisted -- the rules create them
 * that way so Postgres assigns the id from its sequence, rather than each
 * module inventing `max + 1` and colliding with another player mid-tick.
 * Missions the tick dropped (arrived, aborted, or unloaded) are deleted.
 */
async function saveMissions(client: Queryable, state: PlayerState) {
  const owned = state.towns.map((t) => t.id)
  const keep = state.missions.map((m) => m.id).filter((id) => id > 0)

  if (owned.length > 0) {
    await client.query(
      `delete from missions
       where (user_id = $1 or from_town_id = any($2::int[]) or to_town_id = any($2::int[]))
         and not (id = any($3::int[]))`,
      [state.user.id, owned, keep],
    )
  }

  for (const m of state.missions) {
    const values = [
      m.userId,
      m.fromTownId,
      m.toTownId,
      m.kind,
      ts(m.loadingFromStartedAt),
      ts(m.loadingToStartedAt),
      ts(m.departedAt),
      ts(m.returnStartedAt),
      ts(m.arrivesAt),
      m.abortPercent,
      m.transports,
      ...RESOURCES.map((r) => m.cargo[r]),
      m.cargo.gold,
      m.cargo.peoples,
    ]

    let missionId = m.id
    if (missionId > 0) {
      await client.query(
        `update missions set user_id=$2, from_town_id=$3, to_town_id=$4, kind=$5,
           loading_from_started_at=$6, loading_to_started_at=$7, departed_at=$8,
           return_started_at=$9, arrives_at=$10, abort_percent=$11, transports=$12,
           wood=$13, wine=$14, marble=$15, crystal=$16, sulfur=$17, gold=$18, peoples=$19
         where id=$1`,
        [missionId, ...values],
      )
    } else {
      const { rows } = await client.query(
        `insert into missions (user_id, from_town_id, to_town_id, kind,
           loading_from_started_at, loading_to_started_at, departed_at,
           return_started_at, arrives_at, abort_percent, transports,
           wood, wine, marble, crystal, sulfur, gold, peoples)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         returning id`,
        values,
      )
      missionId = Number(rows[0].id)
      // Write the assigned id back so a caller that keeps the state (the
      // /api/state handler does) does not re-insert it on the next save.
      m.id = missionId
    }

    const units = Object.entries(m.units)
      .filter(([, count]) => count > 0)
      .map(([unitType, count]) => [missionId, Number(unitType), count])
    await replace(
      client,
      'mission_units',
      ['mission_id', 'unit_type', 'count'],
      'mission_id',
      missionId,
      units,
    )

    const terms = Object.entries(m.tradeTerms)
      .filter(([, t]) => t != null)
      .map(([resource, t]) => [missionId, resource, t!.count, t!.price])
    await replace(
      client,
      'mission_trade_terms',
      ['mission_id', 'resource', 'count', 'price'],
      'mission_id',
      missionId,
      terms,
    )
  }
}

async function saveTradeRoutes(client: Queryable, state: PlayerState) {
  const keep = state.tradeRoutes.map((r) => r.id).filter((id) => id > 0)
  await client.query(
    'delete from trade_routes where user_id = $1 and not (id = any($2::int[]))',
    [state.user.id, keep],
  )
  for (const r of state.tradeRoutes) {
    const values = [
      r.userId,
      r.fromTownId,
      r.toTownId,
      ts(r.nextRunAt),
      r.resource,
      r.sendCount,
      r.sendTime,
    ]
    if (r.id > 0) {
      await client.query(
        `update trade_routes set user_id=$2, from_town_id=$3, to_town_id=$4,
           next_run_at=$5, resource=$6, send_count=$7, send_time=$8 where id=$1`,
        [r.id, ...values],
      )
    } else {
      const { rows } = await client.query(
        `insert into trade_routes (user_id, from_town_id, to_town_id, next_run_at,
           resource, send_count, send_time)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        values,
      )
      r.id = Number(rows[0].id)
    }
  }
}

async function saveSpies(client: Queryable, state: PlayerState) {
  const keep = state.spies.map((s) => s.id).filter((id) => id > 0)
  await client.query('delete from spies where user_id = $1 and not (id = any($2::int[]))', [
    state.user.id,
    keep,
  ])
  for (const s of state.spies) {
    const values = [
      s.userId,
      s.fromTownId,
      s.toTownId,
      s.risk,
      s.missionType,
      ts(s.startedAt),
      ts(s.lastUpdate),
    ]
    if (s.id > 0) {
      await client.query(
        `update spies set user_id=$2, from_town_id=$3, to_town_id=$4, risk=$5,
           mission_type=$6, started_at=$7, last_update=$8 where id=$1`,
        [s.id, ...values],
      )
    } else {
      const { rows } = await client.query(
        `insert into spies (user_id, from_town_id, to_town_id, risk, mission_type,
           started_at, last_update)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        values,
      )
      s.id = Number(rows[0].id)
    }
  }
}

async function saveMessages(client: Queryable, messages: PendingMessage[]) {
  const townMessages = messages.filter((m) => m.channel === 'town' && m.userId > 0)
  if (townMessages.length > 0) {
    const { text, params } = tuples(
      townMessages.map((m) => [m.userId, m.townId ?? null, m.kind, JSON.stringify(m.params)]),
    )
    await client.query(
      `insert into town_messages (user_id, town_id, kind, params) values ${text}`,
      params,
    )
  }

  const spyMessages = messages.filter((m) => m.channel === 'spy' && m.userId > 0)
  if (spyMessages.length > 0) {
    const { text, params } = tuples(
      spyMessages.map((m) => [m.userId, m.kind, JSON.stringify(m.params)]),
    )
    await client.query(
      `insert into spy_messages (user_id, summary, report) values ${text}`,
      params,
    )
  }
}
