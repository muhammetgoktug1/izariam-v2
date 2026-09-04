/**
 * Player administration.
 *
 * Reads are a paged list over `users` plus a town count; writes are limited to
 * the three things a moderator actually needs -- rename, re-address, ban -- and
 * one thing they deliberately cannot do: delete. A `users` row cascades through
 * towns, army, missions, messages and scores, and none of it comes back.
 *
 * Nothing here touches gold, ambrosia, research points or the premium expiries.
 * The tick owns those: `advance()` recomputes them from `towns.last_update` and
 * `persist()` writes the whole graph back, so a value poked in behind the
 * engine is either overwritten or corrupts the accrual. Granting resources is a
 * game action and belongs in the rules, not in an UPDATE.
 */

import type { AdminPlayerSort } from '@izariam/shared/admin'

import { LOGIN_MAX, LOGIN_MIN, validEmail } from '../actions/register.js'
import { loginTaken } from '../state/foreign.js'
import type { Queryable } from '../state/load.js'
import { audit } from './audit.js'

export type PlayerErrorCode = 'not_found' | 'name_taken' | 'name_length' | 'invalid_email'

export class PlayerFailure extends Error {
  constructor(readonly code: PlayerErrorCode) {
    super(code)
    this.name = 'PlayerFailure'
  }
}

export function playerFailureStatus(code: PlayerErrorCode): 400 | 404 | 409 {
  if (code === 'not_found') return 404
  return code === 'name_taken' ? 409 : 400
}

/**
 * A ban nobody outlives, as a finite instant.
 *
 * There is no separate "permanent" column because `verifyLogin` only ever
 * compares `blocked_until > now()` (auth.ts:113), so a far-future instant *is*
 * a permanent ban and both kinds stay on one code path.
 *
 * It must not be `infinity`: node-postgres maps a timestamptz `infinity` to the
 * JS number `Infinity`, `new Date(Infinity)` is an Invalid Date, and
 * `NaN > Date.now()` is false -- so `verifyLogin` would read it as an elapsed
 * ban, clear it, and let the account straight back in.
 */
export const PERMANENT_BAN_UNTIL = '9999-12-31T00:00:00Z'

/** Anything past this reads as permanent in the UI. */
const PERMANENT_THRESHOLD = '9000-01-01T00:00:00Z'

/** The columns the list may be ordered by, mapped to SQL. A whitelist, because
 *  an ORDER BY cannot take a parameter placeholder. */
const SORTS: Record<AdminPlayerSort, string> = {
  id: 'u.id',
  login: 'lower(u.login)',
  created: 'u.created_at',
  lastVisit: 'u.last_visit_at',
  banned: 'u.blocked_until',
  towns: 'town_count',
}

export interface PlayerRow {
  id: number
  login: string
  email: string
  createdAt: number
  lastVisitAt: number | null
  blockedUntil: number | null
  blockedReason: string | null
  banned: boolean
  permanentBan: boolean
  townCount: number
}

function epoch(value: unknown): number | null {
  return value ? Math.floor(new Date(value as string).getTime() / 1000) : null
}

function toRow(r: Record<string, unknown>): PlayerRow {
  return {
    id: Number(r.id),
    login: String(r.login),
    email: String(r.email),
    createdAt: epoch(r.created_at) ?? 0,
    lastVisitAt: epoch(r.last_visit_at),
    blockedUntil: epoch(r.blocked_until),
    blockedReason: (r.blocked_reason as string | null) ?? null,
    banned: Boolean(r.banned),
    permanentBan: Boolean(r.permanent_ban),
    townCount: Number(r.town_count ?? 0),
  }
}

/**
 * What `q` matches, written once because two queries need it: the page and its
 * count. Split across the two, they would drift and the list would disagree
 * with its own "Toplam N oyuncu".
 *
 * The id branch is what lets a moderator paste the `#928` they just read off
 * the audit log. It is guarded in SQL rather than by coercing in JS so that
 * '0928', '9e9' and '12abc' all simply miss -- and bounded to nine digits
 * because `'999999999999'::int` does not return nothing, it raises `integer out
 * of range` and turns a search box into a 500.
 */
const MATCHES = `($1 = ''
    or u.login ilike '%' || $1 || '%'
    or u.email ilike '%' || $1 || '%'
    or ($1 ~ '^[0-9]{1,9}$' and u.id = $1::int))`

export async function listPlayers(
  client: Queryable,
  input: { q: string; page: number; perPage: number; sort: AdminPlayerSort; dir: 'asc' | 'desc' },
): Promise<{ rows: PlayerRow[]; total: number; page: number; perPage: number }> {
  const search = input.q.trim()
  const direction = input.dir === 'asc' ? 'asc' : 'desc'
  const order = `${SORTS[input.sort]} ${direction} nulls last, u.id asc`

  const { rows } = await client.query(
    `select u.id, u.login, u.email, u.created_at, u.last_visit_at,
            u.blocked_until, u.blocked_reason,
            -- An *elapsed* ban is not a ban: verifyLogin clears it on the next
            -- login attempt, so a plain "blocked_until is not null" would show
            -- every expired ban as active forever.
            (u.blocked_until is not null and u.blocked_until > now())            as banned,
            (u.blocked_until is not null and u.blocked_until > $4::timestamptz)  as permanent_ban,
            (select count(*)::int from towns t where t.user_id = u.id)           as town_count,
            count(*) over()::int                                                 as total
       from users u
      where ${MATCHES}
      order by ${order}
      limit $2 offset $3`,
    [search, input.perPage, input.page * input.perPage, PERMANENT_THRESHOLD],
  )

  return {
    rows: rows.map(toRow),
    total: rows.length > 0 ? Number(rows[0].total) : await countPlayers(client, search),
    page: input.page,
    perPage: input.perPage,
  }
}

/** Only needed when the page came back empty -- `count(*) over()` has no row to
 *  ride on then. */
async function countPlayers(client: Queryable, search: string): Promise<number> {
  const { rows } = await client.query(
    `select count(*)::int as total from users u where ${MATCHES}`,
    [search],
  )
  return Number(rows[0]?.total ?? 0)
}

export interface PlayerTown {
  id: number
  name: string
  islandId: number
  slot: number
  x: number
  y: number
}

export async function getPlayer(
  client: Queryable,
  id: number,
): Promise<{ player: PlayerRow; towns: PlayerTown[] } | null> {
  const { rows } = await client.query(
    `select u.id, u.login, u.email, u.created_at, u.last_visit_at,
            u.blocked_until, u.blocked_reason,
            (u.blocked_until is not null and u.blocked_until > now())           as banned,
            (u.blocked_until is not null and u.blocked_until > $2::timestamptz) as permanent_ban,
            (select count(*)::int from towns t where t.user_id = u.id)          as town_count
       from users u where u.id = $1`,
    [id, PERMANENT_THRESHOLD],
  )
  if (rows.length === 0) return null

  const towns = await client.query(
    `select t.id, t.name, t.island_id, t.slot, i.x, i.y
       from towns t join islands i on i.id = t.island_id
      where t.user_id = $1 order by t.id asc`,
    [id],
  )

  return {
    player: toRow(rows[0]),
    towns: towns.rows.map((t: Record<string, unknown>) => ({
      id: Number(t.id),
      name: String(t.name),
      islandId: Number(t.island_id),
      slot: Number(t.slot),
      x: Number(t.x),
      y: Number(t.y),
    })),
  }
}

/**
 * Rename and re-address only.
 *
 * The player's own rename path charges ambrosia (`/actions/renameLogin`, a rule
 * in packages/rules); an administrative correction is not a purchase, so the
 * write is direct. The uniqueness check is the same one that path uses.
 */
export async function updatePlayer(
  client: Queryable,
  actor: { id: number; ip?: string | undefined },
  targetId: number,
  input: { login?: string; email?: string },
): Promise<void> {
  const { rows } = await client.query('select id from users where id = $1 for update', [targetId])
  if (rows.length === 0) throw new PlayerFailure('not_found')

  const sets: string[] = []
  const values: unknown[] = []
  const changed: string[] = []

  if (input.login !== undefined) {
    const login = input.login.trim()
    if (login.length < LOGIN_MIN || login.length > LOGIN_MAX) {
      throw new PlayerFailure('name_length')
    }
    if (await loginTaken(client, login, targetId)) throw new PlayerFailure('name_taken')
    values.push(login)
    sets.push(`login = $${values.length}`)
    changed.push('login')
  }
  if (input.email !== undefined) {
    const email = input.email.trim()
    if (!validEmail(email)) throw new PlayerFailure('invalid_email')
    values.push(email)
    sets.push(`email = $${values.length}`)
    changed.push('email')
  }
  if (sets.length === 0) return

  values.push(targetId)
  await client.query(`update users set ${sets.join(', ')} where id = $${values.length}`, values)

  await audit(client, {
    adminUserId: actor.id,
    action: 'player.update',
    targetType: 'player',
    targetId,
    meta: { changed },
    ip: actor.ip,
  })
}

export interface BanResult {
  blockedUntil: number
  permanent: boolean
  sessionsRevoked: number
}

/**
 * Ban a player, and make it bite immediately.
 *
 * `requireSession` reads `sessions` alone and never joins `users`
 * (auth.ts:132-149), so `blocked_until` is consulted in exactly one place:
 * `verifyLogin`, at the next login. Without the session sweep below a banned
 * player simply keeps playing for the remaining seven days of their cookie.
 * `consumePasswordReset` already does the same thing for the same reason
 * (actions/password-reset.ts:105).
 *
 * Both statements share one transaction, so a ban can never land without it.
 */
export async function banPlayer(
  client: Queryable,
  actor: { id: number; ip?: string | undefined },
  targetId: number,
  input: { permanent: boolean; seconds?: number | undefined; reason: string },
): Promise<BanResult> {
  const reason = input.reason.trim() === '' ? null : input.reason.trim()

  const { rows } = input.permanent
    ? await client.query(
        `update users set blocked_until = $2::timestamptz, blocked_reason = $3
          where id = $1 returning blocked_until`,
        [targetId, PERMANENT_BAN_UNTIL, reason],
      )
    : await client.query(
        `update users set blocked_until = now() + make_interval(secs => $2),
                          blocked_reason = $3
          where id = $1 returning blocked_until`,
        [targetId, input.seconds ?? 0, reason],
      )
  if (rows.length === 0) throw new PlayerFailure('not_found')

  // `returning` rather than rowCount: the shared `Queryable` interface only
  // promises `rows`, because most callers run inside a transaction client.
  const revoked = await client.query(
    'delete from sessions where user_id = $1 returning id',
    [targetId],
  )
  const sessionsRevoked = revoked.rows.length
  const blockedUntil = new Date(rows[0].blocked_until as string)

  await audit(client, {
    adminUserId: actor.id,
    action: 'player.ban',
    targetType: 'player',
    targetId,
    meta: {
      permanent: input.permanent,
      seconds: input.seconds ?? null,
      reason,
      until: blockedUntil.toISOString(),
      sessionsRevoked,
    },
    ip: actor.ip,
  })

  return {
    blockedUntil: Math.floor(blockedUntil.getTime() / 1000),
    permanent: input.permanent,
    sessionsRevoked,
  }
}

export async function unbanPlayer(
  client: Queryable,
  actor: { id: number; ip?: string | undefined },
  targetId: number,
): Promise<void> {
  const { rows } = await client.query(
    `update users set blocked_until = null, blocked_reason = null
      where id = $1 returning id`,
    [targetId],
  )
  if (rows.length === 0) throw new PlayerFailure('not_found')

  await audit(client, {
    adminUserId: actor.id,
    action: 'player.unban',
    targetType: 'player',
    targetId,
    ip: actor.ip,
  })
}
