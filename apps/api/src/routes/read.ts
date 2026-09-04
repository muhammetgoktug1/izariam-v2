/**
 * Read-only endpoints that /api/state cannot answer.
 *
 * 68 of the legacy's 70 read screens rendered off the same Player_Model graph,
 * which is why they collapse into one /api/state. These five are the rest: they
 * either look at somebody else's rows (island, branch office, highscore) or at
 * a table the graph deliberately leaves out because it is unbounded (mail,
 * notes).
 */

import { wonderGoods, wonderUpgradeCost } from '@izariam/rules'
import { Router } from 'express'

import { requireCsrf } from '../auth.js'
import { pool } from '../db.js'
import { islandWonderRoster, mailbox, spyTarget } from '../state/foreign.js'

export const readRouter: Router = Router()

/** Islands have 17 town slots; the board renders 0..15. */
const ISLAND_SLOTS = 17

/**
 * One island with every slot, occupied or not.
 *
 * Island_Model::Load_Island fired up to 33 queries for this -- one per slot for
 * the town, one per town for its owner (island_model.php). Two here.
 */
readRouter.get('/island/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_island' })
    return
  }

  const { rows: islands } = await pool.query(
    `select i.*,
       (select count(*)::int from towns where island_id = i.id) as town_count
     from islands i where i.id = $1`,
    [id],
  )
  const island = islands[0]
  if (!island) {
    res.status(404).json({ error: 'unknown_island' })
    return
  }

  const { rows: towns } = await pool.query(
    `select t.id, t.slot, t.name, t.user_id, u.login as owner,
       coalesce((select level from town_buildings where town_id = t.id and slot = 0), 0) as level,
       coalesce((select value from user_scores where user_id = u.id and category = 'total'), 0)
         as score,
       exists(select 1 from town_buildings where town_id = t.id and type = 12) as has_branch,
       t.workers, t.tradegood, t.workers_wood, t.tradegood_wood
     from towns t join users u on u.id = t.user_id
     where t.island_id = $1
     order by t.slot`,
    [id],
  )

  const slots = Array.from({ length: ISLAND_SLOTS }, (_, slot) => {
    const town = towns.find((t) => Number(t.slot) === slot)
    if (!town) return { slot, town: null }
    return {
      slot,
      town: {
        id: Number(town.id),
        name: String(town.name),
        userId: Number(town.user_id),
        owner: String(town.owner),
        level: Number(town.level),
        score: Number(town.score),
        hasBranchOffice: Boolean(town.has_branch),
        // The island camps' roster prints these per town (resource.php:106-107,
        // tradegood.php:137-138), so every row carries its own -- not the
        // viewer's -- figures.
        workers: Math.floor(Number(town.workers)),
        tradegood: Math.floor(Number(town.tradegood)),
        workersWood: Math.floor(Number(town.workers_wood)),
        tradegoodWood: Math.floor(Number(town.tradegood_wood)),
      },
    }
  })

  res.json({
    island: {
      id: Number(island.id),
      name: String(island.name),
      x: Number(island.x),
      y: Number(island.y),
      type: Number(island.type),
      tradeResource: Number(island.trade_resource),
      wonder: Number(island.wonder),
      woodLevel: Number(island.wood_level),
      tradeLevel: Number(island.trade_level),
      woodDonated: Number(island.wood_donated),
      tradeDonated: Number(island.trade_donated),
      wonderLevel: Number(island.wonder_level),
      townCount: Number(island.town_count),
    },
    slots,
  })
})

/**
 * The monument: what it is standing at, what it is waiting for, and who on the
 * island has put anything into it.
 *
 * Its own request rather than a field on /api/state, which the client refetches
 * on every screen change: this is one row per town on the island, up to
 * seventeen of them, for the one screen that shows them. Island *faith* stays
 * in /api/state because that is a single number.
 */
readRouter.get('/island/:id/wonder', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_island' })
    return
  }

  const roster = await islandWonderRoster(pool, id)
  if (!roster) {
    res.status(404).json({ error: 'unknown_island' })
    return
  }

  const goods = wonderGoods(roster.island.tradeResource)
  res.json({
    island: {
      ...roster.island,
      goods,
      costPerGood: wonderUpgradeCost(roster.island.wonderLevel),
    },
    faith: roster.faith,
    towns: roster.towns,
  })
})

/**
 * Mail, one box at a time. Not part of /api/state: it is the only unbounded
 * collection a player owns, and the chrome only needs its unread count.
 *
 * The rows gain what the diplomacy advisor's table prints next to each entry
 * (diplomacyAdvisor.php:96-112): both logins, and the sender's capital town
 * with its island coordinates. Display-only, so it is attached here rather
 * than widening the rules' `UserMessage`.
 */
readRouter.get('/messages/:box', async (req, res) => {
  const box = req.params.box
  if (box !== 'inbox' && box !== 'outbox') {
    res.status(400).json({ error: 'unknown_mailbox' })
    return
  }
  const mail = await mailbox(pool, req.userId!)
  const messages = mail[box]
  const ids = [...new Set(messages.flatMap((m) => [m.from, m.to]).filter((id) => id > 0))]
  const names = new Map<
    number,
    {
      login: string
      townId: number | null
      townName: string | null
      islandId: number | null
      x: number | null
      y: number | null
    }
  >()

  if (ids.length > 0) {
    const { rows } = await pool.query(
      `select u.id, u.login,
              t.id as town_id, t.name as town_name,
              i.id as island_id, i.x, i.y
         from users u
         left join towns t on t.id = u.capital_town_id
         left join islands i on i.id = t.island_id
        where u.id = any($1::int[])`,
      [ids],
    )
    for (const r of rows) {
      names.set(Number(r.id), {
        login: String(r.login),
        townId: r.town_id == null ? null : Number(r.town_id),
        townName: r.town_name == null ? null : String(r.town_name),
        islandId: r.island_id == null ? null : Number(r.island_id),
        x: r.x == null ? null : Number(r.x),
        y: r.y == null ? null : Number(r.y),
      })
    }
  }

  res.json({
    messages: messages.map((m) => {
      const from = names.get(m.from)
      return {
        ...m,
        fromLogin: from?.login ?? `#${m.from}`,
        toLogin: names.get(m.to)?.login ?? `#${m.to}`,
        fromTown: from?.townId
          ? {
              id: from.townId,
              name: from.townName,
              islandId: from.islandId,
              x: from.x,
              y: from.y,
            }
          : null,
      }
    }),
  })
})

/**
 * The town advisor's news list, izariam/views/view/tradeAdvisor.php.
 *
 * Same window as `Load_Town_Messages` (player_model.php:322): the last seven
 * days, newest first. The unread *count* the chrome shows has no window, which
 * is the legacy's own asymmetry (`Load_New_Town_Messages`, :367) and is kept.
 *
 * Rows are structured (`kind` + `params`) rather than the legacy's
 * pre-rendered HTML, so the client picks the language.
 */
readRouter.get('/town-messages', async (req, res) => {
  const { rows } = await pool.query(
    `select id, town_id, kind, params, extract(epoch from created_at)::int as created_at,
            read_at is not null as read
       from town_messages
      where user_id = $1 and created_at > now() - interval '7 days'
      order by created_at desc, id desc
      limit 200`,
    [req.userId!],
  )
  res.json({
    messages: rows.map((r) => ({
      id: Number(r.id),
      townId: r.town_id == null ? null : Number(r.town_id),
      kind: String(r.kind),
      params: JSON.parse(String(r.params)) as Record<string, unknown>,
      createdAt: Number(r.created_at),
      read: Boolean(r.read),
    })),
  })
})

/**
 * Mark the whole list read, which is what opening the advisor did in the
 * legacy -- `UPDATE ... SET checked = 1 WHERE user = <id>`, run as a side
 * effect of rendering the template (tradeAdvisor.php:86-90). A GET with that
 * side effect would be worse than the original, so it is its own POST.
 *
 * Nothing in `PlayerState` changes, so this does not go through the rules
 * engine; like `PUT /notes` it carries the CSRF gate itself.
 */
readRouter.post('/town-messages/read', requireCsrf, async (req, res) => {
  const { rowCount } = await pool.query(
    'update town_messages set read_at = now() where user_id = $1 and read_at is null',
    [req.userId!],
  )
  res.json({ ok: true, marked: rowCount ?? 0 })
})

/** The nine score categories, matching the score_category enum. Replaces the
 *  legacy's nine float(11,0) columns on users. */
const CATEGORIES = new Set([
  'total',
  'buildings',
  'levels',
  'peoples',
  'research',
  'complete',
  'army',
  'gold',
  'transports',
])

readRouter.get('/highscore', async (req, res) => {
  const category = String(req.query.category ?? 'total')
  if (!CATEGORIES.has(category)) {
    res.status(400).json({ error: 'unknown_category' })
    return
  }
  const page = Math.max(0, Number(req.query.page ?? 0) || 0)
  const perPage = 100

  const { rows } = await pool.query(
    `select rank() over (order by s.value desc, u.id) as rank,
            u.id, u.login, s.value,
            (select count(*)::int from towns where user_id = u.id) as towns
     from user_scores s join users u on u.id = s.user_id
     where s.category = $1
     order by s.value desc, u.id
     limit $2 offset $3`,
    [category, perPage, page * perPage],
  )

  const { rows: totals } = await pool.query(
    'select count(*)::int as n from user_scores where category = $1',
    [category],
  )

  res.json({
    category,
    page,
    perPage,
    total: Number(totals[0]?.n ?? 0),
    rows: rows.map((r) => ({
      rank: Number(r.rank),
      userId: Number(r.id),
      login: String(r.login),
      value: Number(r.value),
      towns: Number(r.towns),
    })),
  })
})

/**
 * Somebody else's shelf: what the takeOffer screen renders. Only offers with
 * stock are listed, which is also all the trade action can act on.
 */
readRouter.get('/town/:id/branch-office', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_town' })
    return
  }
  const { rows } = await pool.query(
    `select t.id, t.name, t.user_id, u.login as owner, i.x, i.y, i.name as island,
       coalesce((select json_agg(json_build_object('resource', resource, 'direction', direction,
                                                   'count', count, 'price', price))
                 from branch_offers where town_id = t.id and count > 0), '[]'::json) as offers,
       exists(select 1 from town_buildings where town_id = t.id and type = 12) as has_branch
     from towns t join users u on u.id = t.user_id join islands i on i.id = t.island_id
     where t.id = $1`,
    [id],
  )
  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'unknown_town' })
    return
  }
  res.json({
    town: {
      id: Number(row.id),
      name: String(row.name),
      userId: Number(row.user_id),
      owner: String(row.owner),
      x: Number(row.x),
      y: Number(row.y),
      island: String(row.island),
      hasBranchOffice: Boolean(row.has_branch),
    },
    offers: (row.offers as any[]).map((o) => ({
      resource: o.resource,
      direction: o.direction === 'sell' ? 1 : 0,
      count: Number(o.count),
      price: Number(o.price),
    })),
  })
})

/**
 * The towns this player's spies are sitting in.
 *
 * The safehouse screens price every mission against the target's defences, and
 * those live on somebody else's rows. Returned as a map keyed by spy id so the
 * screen does not have to join anything.
 */
readRouter.get('/spy-targets', async (req, res) => {
  const { rows } = await pool.query(
    'select id, to_town_id from spies where user_id = $1 and to_town_id is not null',
    [req.userId!],
  )
  const out: Record<number, unknown> = {}
  for (const row of rows) {
    const target = await spyTarget(pool, Number(row.to_town_id))
    if (target) out[Number(row.id)] = target
  }
  res.json({ targets: out })
})

/** The floating notepad (views/avatarNotes.php). One text field per account. */
readRouter.get('/notes', async (req, res) => {
  const { rows } = await pool.query('select body from notes where user_id = $1', [req.userId!])
  res.json({ text: String(rows[0]?.body ?? '') })
})

// The one write in this router, so it carries the CSRF gate itself rather than
// riding the mount that covers /api/actions/*.
readRouter.put('/notes', requireCsrf, async (req, res) => {
  const text = req.body?.text
  if (typeof text !== 'string' || text.length > 20_000) {
    res.status(400).json({ error: 'invalid_notes' })
    return
  }
  await pool.query(
    `insert into notes (user_id, body) values ($1, $2)
     on conflict (user_id) do update set body = excluded.body`,
    [req.userId!, text],
  )
  res.json({ ok: true })
})
