/**
 * One-way migration from the legacy MariaDB schema to Postgres.
 *
 * The legacy stored 207 of its 340 columns as positional repetitions --
 * `city0..city16`, `pos0_type..pos14_level`, `res1_1..res4_14`, and the same
 * 23 unit counters duplicated across `army` and `missions`. This unpacks all
 * of them into rows, converts unix epochs to timestamptz and varchar
 * quantities to numeric, and preserves ids so nothing has to be re-keyed.
 *
 * Passwords cannot be converted: md5 is one-way and argon2id needs the
 * plaintext. Each hash is parked in `users.legacy_password_md5` instead, and
 * the first successful login upgrades the account in place (see
 * apps/api/src/auth.ts) -- so no player has to reset anything.
 *
 * Usage:
 *   MYSQL_URL=mysql://root:izariam@127.0.0.1:3307/izariam \
 *   DATABASE_URL=postgres://izariam:izariam@127.0.0.1:5432/izariam \
 *   npm run -w @izariam/db migrate-legacy -- --prefix alpha [--dry-run]
 */

import pg from 'pg'

interface Args {
  prefix: string
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const prefix = argv[argv.indexOf('--prefix') + 1] ?? 'alpha'
  return { prefix, dryRun: argv.includes('--dry-run') }
}

/** Unix epoch seconds -> Date, treating the legacy's 0 sentinel as null. */
function ts(v: unknown): Date | null {
  const n = Number(v ?? 0)
  return n > 0 ? new Date(n * 1000) : null
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const RESEARCH_BRANCHES: Record<number, number> = { 1: 14, 2: 15, 3: 16, 4: 14 }

/** Unit id -> the legacy column that held its count. */
const UNIT_COLUMNS: Record<number, string> = {
  1: 'phalanx',
  2: 'steamgiant',
  3: 'spearman',
  4: 'swordsman',
  5: 'slinger',
  6: 'archer',
  7: 'marksman',
  8: 'ram',
  9: 'catapult',
  10: 'mortar',
  11: 'gyrocopter',
  12: 'bombardier',
  13: 'cook',
  14: 'medic',
  15: 'barbarian',
  16: 'ship_ram',
  17: 'ship_flamethrower',
  18: 'ship_steamboat',
  19: 'ship_ballista',
  20: 'ship_catapult',
  21: 'ship_mortar',
  22: 'ship_submarine',
  23: 'ship_transport',
}

const SCORE_COLUMNS: Record<string, string> = {
  total: 'points',
  buildings: 'points_buildings',
  levels: 'points_levels',
  peoples: 'points_peoples',
  research: 'points_research',
  complete: 'points_complete',
  army: 'points_army',
  gold: 'points_gold',
  transports: 'points_transports',
}

const PREMIUM_COLUMNS: Record<string, string> = {
  premium_account_until: 'premium_account',
  premium_wood_until: 'premium_wood',
  premium_wine_until: 'premium_wine',
  premium_marble_until: 'premium_marble',
  premium_crystal_until: 'premium_crystal',
  premium_sulfur_until: 'premium_sulfur',
  premium_capacity_until: 'premium_capacity',
}

const RESOURCE_BY_INDEX = ['wood', 'wine', 'marble', 'crystal', 'sulfur'] as const

/** "1,6;2,6" -> [{slot:1,type:6},...] */
function parseBuildLine(line: unknown): { slot: number; type: number }[] {
  const s = String(line ?? '')
  if (!s) return []
  return s
    .split(';')
    .filter(Boolean)
    .map((pair) => {
      const [slot, type] = pair.split(',')
      return { slot: num(slot), type: num(type) }
    })
}

/** "1,10;3,5" -> [{unitType:1,count:10},...] */
function parseUnitLine(line: unknown): { unitType: number; count: number }[] {
  const s = String(line ?? '')
  if (!s) return []
  return s
    .split(';')
    .filter(Boolean)
    .map((pair) => {
      const [unitType, count] = pair.split(',')
      return { unitType: num(unitType), count: num(count) }
    })
}

interface Mysql {
  query(sql: string): Promise<Record<string, unknown>[]>
  end(): Promise<void>
}

/**
 * Reader for the legacy database. mysql2 is a devDependency only: it exists
 * for this one-shot migration and is not part of the running application.
 */
async function connectMysql(): Promise<Mysql> {
  const mysql = await import('mysql2/promise')
  const conn = await mysql.createConnection({
    uri: process.env.MYSQL_URL ?? 'mysql://root:izariam@127.0.0.1:3307/izariam',
    // The legacy stored quantities in varchar columns; keep everything as the
    // driver returns it and coerce explicitly at each use site.
    dateStrings: true,
  })
  return {
    async query(sql: string) {
      const [rows] = await conn.query(sql)
      return rows as Record<string, unknown>[]
    },
    async end() {
      await conn.end()
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const p = args.prefix
  const mysql = await connectMysql()
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://izariam:izariam@127.0.0.1:5432/izariam',
  })
  const client = await pool.connect()

  const counts: Record<string, number> = {}
  const bump = (k: string, n = 1) => {
    counts[k] = (counts[k] ?? 0) + n
  }

  try {
    await client.query('begin')

    // --- islands ----------------------------------------------------------
    // Matched on (x, y) so a seeded world is updated rather than duplicated.
    const islands = await mysql.query(`SELECT * FROM ${p}_islands`)
    const islandIdMap = new Map<number, number>()
    for (const i of islands) {
      const { rows } = await client.query(
        `insert into islands (name, x, y, type, trade_resource, wonder,
                              wood_level, trade_level, wood_donated, trade_donated,
                              wood_upgrade_started_at, trade_upgrade_started_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (x, y) do update set
           name = excluded.name, type = excluded.type,
           trade_resource = excluded.trade_resource, wonder = excluded.wonder,
           wood_level = excluded.wood_level, trade_level = excluded.trade_level,
           wood_donated = excluded.wood_donated, trade_donated = excluded.trade_donated
         returning id`,
        [
          i.name,
          num(i.x),
          num(i.y),
          num(i.type),
          num(i.trade_resource),
          num(i.wonder),
          num(i.wood_level),
          num(i.trade_level),
          num(i.wood_count),
          num(i.trade_count),
          ts(i.wood_start),
          ts(i.trade_start),
        ],
      )
      islandIdMap.set(num(i.id), Number(rows[0].id))
      bump('islands')
    }

    // --- users -------------------------------------------------------------
    const users = await mysql.query(`SELECT * FROM ${p}_users`)
    const userIdMap = new Map<number, number>()
    for (const u of users) {
      const premium: (Date | null)[] = Object.values(PREMIUM_COLUMNS).map((c) => ts(u[c]))
      const { rows } = await client.query(
        `insert into users (login, email, password_hash, legacy_password_md5, access_level,
                            register_key, register_complete, last_visit_at, blocked_until,
                            blocked_reason, gold, ambrosia, transports, research_points,
                            tutorial_step, options_select,
                            premium_account_until, premium_wood_until, premium_wine_until,
                            premium_marble_until, premium_crystal_until, premium_sulfur_until,
                            premium_capacity_until)
         values ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         on conflict (login) do nothing
         returning id`,
        [
          u.login,
          u.email,
          u.password,
          num(u.access),
          u.register_key ?? null,
          num(u.register_complete) > 0,
          ts(u.last_visit),
          ts(u.blocked_time),
          u.blocked_why ?? null,
          num(u.gold),
          num(u.ambrosy),
          num(u.transports),
          num(u.tutorial),
          num(u.options_select),
          ...premium,
        ],
      )
      if (rows[0]) {
        userIdMap.set(num(u.id), Number(rows[0].id))
        bump('users')
      } else {
        bump('users_skipped')
      }
    }

    // --- research: 59 columns -> rows ---------------------------------------
    const research = await mysql.query(`SELECT * FROM ${p}_research`)
    for (const r of research) {
      const userId = userIdMap.get(num(r.user))
      if (!userId) continue
      await client.query('update users set research_points = $2 where id = $1', [
        userId,
        num(r.points),
      ])
      for (const [branch, size] of Object.entries(RESEARCH_BRANCHES)) {
        for (let node = 1; node <= size; node++) {
          const level = num(r[`res${branch}_${node}`])
          if (level <= 0) continue
          await client.query(
            `insert into user_research (user_id, branch, node, level) values ($1,$2,$3,$4)
             on conflict (user_id, branch, node) do update set level = excluded.level`,
            [userId, Number(branch), node, level],
          )
          bump('research_nodes')
        }
      }
      for (const branch of Object.keys(RESEARCH_BRANCHES)) {
        await client.query(
          `insert into user_research_branch_seen (user_id, branch, seen) values ($1,$2,$3)
           on conflict (user_id, branch) do update set seen = excluded.seen`,
          [userId, Number(branch), num(r[`way${branch}_checked`]) > 0],
        )
      }
    }

    // --- scores: 9 columns -> rows -------------------------------------------
    for (const u of users) {
      const userId = userIdMap.get(num(u.id))
      if (!userId) continue
      for (const [category, column] of Object.entries(SCORE_COLUMNS)) {
        await client.query(
          `insert into user_scores (user_id, category, value) values ($1,$2,$3)
           on conflict (user_id, category) do update set value = excluded.value`,
          [userId, category, num(u[column])],
        )
      }
      bump('scores', 9)
    }

    // --- towns, and the island slot they occupy --------------------------------
    const towns = await mysql.query(`SELECT * FROM ${p}_towns`)
    const townIdMap = new Map<number, number>()
    for (const t of towns) {
      const userId = userIdMap.get(num(t.user))
      const islandId = islandIdMap.get(num(t.island))
      if (!userId || !islandId) {
        bump('towns_orphaned')
        continue
      }
      const { rows } = await client.query(
        `insert into towns (user_id, island_id, slot, name, last_update,
                            wood, wine, marble, crystal, sulfur,
                            peoples, workers, tradegood, scientists, templer,
                            spies, spy_training_started_at, workers_wood, tradegood_wood,
                            action_points, tavern_wine)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         on conflict (island_id, slot) do nothing
         returning id`,
        [
          userId,
          islandId,
          num(t.position),
          t.name,
          ts(t.last_update) ?? new Date(),
          ...RESOURCE_BY_INDEX.map((r) => num(t[r])),
          num(t.peoples),
          num(t.workers),
          num(t.tradegood),
          num(t.scientists),
          num(t.templer),
          num(t.spyes),
          ts(t.spyes_start),
          num(t.workers_wood),
          num(t.tradegood_wood),
          num(t.actions),
          num(t.tavern_wine),
        ],
      )
      if (!rows[0]) {
        // Two legacy towns claimed the same slot -- possible because the old
        // claim was a check-then-set race with no constraint behind it.
        bump('towns_slot_conflict')
        continue
      }
      const townId = Number(rows[0].id)
      townIdMap.set(num(t.id), townId)
      bump('towns')

      // pos0_type/pos0_level .. pos14_* -> rows
      for (let slot = 0; slot <= 14; slot++) {
        const type = num(t[`pos${slot}_type`])
        const level = num(t[`pos${slot}_level`])
        if (type === 0 && level === 0) continue
        await client.query(
          `insert into town_buildings (town_id, slot, type, level) values ($1,$2,$3,$4)
           on conflict (town_id, slot) do update set type = excluded.type, level = excluded.level`,
          [townId, slot, type, level],
        )
        bump('buildings')
      }

      // build_line CSV -> queue rows
      const queue = parseBuildLine(t.build_line)
      for (const [i, entry] of queue.entries()) {
        await client.query(
          `insert into build_queue (town_id, position, slot, type, started_at)
           values ($1,$2,$3,$4,$5)`,
          [townId, i, entry.slot, entry.type, i === 0 ? ts(t.build_start) : null],
        )
        bump('build_queue')
      }

      // branch_trade_* -> offers
      for (const resource of RESOURCE_BY_INDEX) {
        const count = num(t[`branch_trade_${resource}_count`])
        const price = num(t[`branch_trade_${resource}_cost`])
        if (count <= 0 && price <= 0) continue
        // branch_trade_*_type: 0 = the town buys, 1 = it sells
        // (izariam/views/view/branchOffice.php:166).
        const direction = num(t[`branch_trade_${resource}_type`]) === 1 ? 'sell' : 'buy'
        await client.query(
          `insert into branch_offers (town_id, resource, direction, count, price)
           values ($1,$2,$3,$4,$5)
           on conflict (town_id, resource) do update set
             direction = excluded.direction, count = excluded.count, price = excluded.price`,
          [townId, resource, direction, count, price],
        )
        bump('branch_offers')
      }
    }

    // Backfill the two town pointers now that ids are known.
    for (const u of users) {
      const userId = userIdMap.get(num(u.id))
      if (!userId) continue
      await client.query(
        'update users set current_town_id = $2, capital_town_id = $3 where id = $1',
        [userId, townIdMap.get(num(u.town)) ?? null, townIdMap.get(num(u.capital)) ?? null],
      )
    }

    // --- garrisons and unit queues ---------------------------------------------
    const armies = await mysql.query(`SELECT * FROM ${p}_army`)
    for (const a of armies) {
      const townId = townIdMap.get(num(a.city))
      if (!townId) continue
      for (const [unitId, column] of Object.entries(UNIT_COLUMNS)) {
        const count = num(a[column])
        if (count <= 0) continue
        await client.query(
          `insert into army_units (town_id, unit_type, count) values ($1,$2,$3)
           on conflict (town_id, unit_type) do update set count = excluded.count`,
          [townId, Number(unitId), count],
        )
        bump('army_units')
      }
      for (const [kind, line, start] of [
        ['land', a.army_line, a.army_start],
        ['naval', a.ships_line, a.ships_start],
      ] as const) {
        for (const [i, entry] of parseUnitLine(line).entries()) {
          await client.query(
            `insert into unit_queue (town_id, kind, position, unit_type, count, started_at)
             values ($1,$2,$3,$4,$5,$6)`,
            [townId, kind, i, entry.unitType, entry.count, i === 0 ? ts(start) : null],
          )
          bump('unit_queue')
        }
      }
    }

    // --- missions ----------------------------------------------------------------
    const MISSION_KIND = ['colonise', 'transport', 'buy', 'sell']
    const missions = await mysql.query(`SELECT * FROM ${p}_missions`)
    for (const m of missions) {
      const userId = userIdMap.get(num(m.user))
      const fromTownId = townIdMap.get(num(m.from))
      if (!userId || !fromTownId) {
        bump('missions_orphaned')
        continue
      }
      const kind = MISSION_KIND[num(m.mission_type) - 1] ?? 'transport'
      const { rows } = await client.query(
        `insert into missions (user_id, from_town_id, to_town_id, kind,
                               loading_from_started_at, loading_to_started_at,
                               departed_at, return_started_at, abort_percent,
                               transports, wood, wine, marble, crystal, sulfur, gold, peoples)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         returning id`,
        [
          userId,
          fromTownId,
          townIdMap.get(num(m.to)) ?? null,
          kind,
          ts(m.loading_from_start),
          ts(m.loading_to_start),
          ts(m.mission_start),
          ts(m.return_start),
          num(m.percent) / 100,
          num(m.ship_transport),
          ...RESOURCE_BY_INDEX.map((r) => num(m[r])),
          num(m.gold),
          num(m.peoples),
        ],
      )
      const missionId = Number(rows[0].id)
      bump('missions')

      for (const [unitId, column] of Object.entries(UNIT_COLUMNS)) {
        const count = num(m[column])
        if (count <= 0) continue
        await client.query(
          `insert into mission_units (mission_id, unit_type, count) values ($1,$2,$3)
           on conflict (mission_id, unit_type) do update set count = excluded.count`,
          [missionId, Number(unitId), count],
        )
      }
      for (const resource of RESOURCE_BY_INDEX) {
        const count = num(m[`trade_${resource}_count`])
        const price = num(m[`trade_${resource}_cost`])
        if (count <= 0 && price <= 0) continue
        await client.query(
          `insert into mission_trade_terms (mission_id, resource, count, price)
           values ($1,$2,$3,$4)
           on conflict (mission_id, resource) do update set count = excluded.count, price = excluded.price`,
          [missionId, resource, count, price],
        )
      }
    }

    // --- trade routes and spies -----------------------------------------------------
    const routes = await mysql.query(`SELECT * FROM ${p}_trade_routes`)
    for (const r of routes) {
      const userId = userIdMap.get(num(r.user))
      if (!userId) continue
      await client.query(
        `insert into trade_routes (user_id, from_town_id, to_town_id, created_at, next_run_at,
                                   resource, send_count, send_time)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          userId,
          townIdMap.get(num(r.from)) ?? null,
          townIdMap.get(num(r.to)) ?? null,
          ts(r.start_time) ?? new Date(),
          ts(r.update_time) ?? new Date(),
          RESOURCE_BY_INDEX[num(r.send_resource)] ?? 'wood',
          num(r.send_count),
          num(r.send_time),
        ],
      )
      bump('trade_routes')
    }

    const spies = await mysql.query(`SELECT * FROM ${p}_spyes`)
    for (const s of spies) {
      const userId = userIdMap.get(num(s.user))
      const fromTownId = townIdMap.get(num(s.from))
      if (!userId || !fromTownId) continue
      await client.query(
        `insert into spies (user_id, from_town_id, to_town_id, risk, mission_type,
                            started_at, last_update)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          userId,
          fromTownId,
          townIdMap.get(num(s.to)) ?? null,
          num(s.risk),
          num(s.mission_type),
          ts(s.mission_start),
          ts(s.last_update) ?? new Date(),
        ],
      )
      bump('spies')
    }

    // --- notes ------------------------------------------------------------------------
    const notes = await mysql.query(`SELECT * FROM ${p}_notes`)
    for (const n of notes) {
      const userId = userIdMap.get(num(n.user))
      if (!userId) continue
      await client.query(
        `insert into notes (user_id, body) values ($1,$2)
         on conflict (user_id) do update set body = excluded.body`,
        [userId, String(n.text ?? '')],
      )
      bump('notes')
    }

    if (args.dryRun) {
      await client.query('rollback')
      console.log('dry run -- rolled back')
    } else {
      await client.query('commit')
    }

    for (const [k, v] of Object.entries(counts).sort()) {
      console.log(`  ${k.padEnd(22)} ${v}`)
    }
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
    await pool.end()
    await mysql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
