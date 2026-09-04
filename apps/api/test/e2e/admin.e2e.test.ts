/**
 * The staff panel, over HTTP, through its own dev proxy.
 *
 * Four of these assertions exist because the failure they catch is silent
 * rather than loud:
 *
 * - the login route answering 401 (the admin router mounted behind the player
 *   session middleware, or its guards mounted on the whole `/api` prefix);
 * - a player session reaching the panel, or a panel session reaching the game
 *   (one shared session table with a forgotten filter would do it);
 * - a ban that leaves the player's live session working (`requireSession` never
 *   joins `users`, so nothing else would notice);
 * - a "permanent" ban stored as `infinity`, which node-postgres hands back as
 *   the JS number `Infinity` and `verifyLogin` then reads as *elapsed* -- it
 *   would clear the ban and let the account in.
 */

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  BASE_URL,
  CSRF_COOKIE,
  Client,
  PASSWORD,
  SEEDED_ADMIN,
  SESSION_COOKIE,
  adminClient,
  cleanup,
  makePool,
  newAdminClient,
  newPlayer,
  probe,
  probeAdmin,
  uniqueAdminEmail,
  uniqueLogin,
} from './harness.js'

let pool: pg.Pool
let up = false

beforeAll(async () => {
  pool = makePool()
  up = (await probe(pool)) && (await probeAdmin())
})

afterAll(async () => {
  if (up) await cleanup(pool)
  await pool?.end()
})

describe('panel login', () => {
  it('answers the login route without a session at all', async () => {
    if (!up) return
    // Not a test of credentials: a 401 `not_authenticated` here would mean the
    // admin router is sitting behind the player session middleware.
    const res = await adminClient().post('/admin/auth/login', {
      email: 'nobody@example.test',
      password: 'x'.repeat(12),
    })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('bad_credentials')
  })

  it('signs the seeded super admin in and sets only the panel cookies', async () => {
    if (!up) return
    const client = adminClient()
    const res = await client.post('/admin/auth/login', SEEDED_ADMIN)

    expect(res.status).toBe(200)
    expect(res.body.admin.email).toBe(SEEDED_ADMIN.email)
    expect(res.body.admin.role).toBe('super_admin')

    expect(client.get(ADMIN_SESSION_COOKIE)?.httpOnly).toBe(true)
    expect(client.get(ADMIN_CSRF_COOKIE)?.httpOnly).toBe(false)
    // The two apps share a cookie jar -- browsers scope by host, not by port.
    expect(client.get(SESSION_COOKIE)).toBeUndefined()
    expect(client.get(CSRF_COOKIE)).toBeUndefined()
  })

  it('refuses a wrong password', async () => {
    if (!up) return
    const res = await adminClient().post('/admin/auth/login', {
      email: SEEDED_ADMIN.email,
      password: 'not the password',
    })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('bad_credentials')
  })

  it('answers a disabled account exactly as it answers a wrong password', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const email = uniqueAdminEmail('off')
    const created = await admin.post('/admin/admins', {
      email,
      name: 'Kapalı',
      password: PASSWORD,
      active: false,
    })
    expect(created.status).toBe(201)

    const disabled = await adminClient().post('/admin/auth/login', { email, password: PASSWORD })
    const wrongPassword = await adminClient().post('/admin/auth/login', {
      email,
      password: 'wrong password here',
    })
    // Naming the reason would confirm which addresses belong to staff.
    expect(disabled.status).toBe(wrongPassword.status)
    expect(disabled.body).toEqual(wrongPassword.body)
  })

  it('logs out and forgets the session row', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const sessionId = admin.get(ADMIN_SESSION_COOKIE)!.value

    const res = await admin.post('/admin/auth/logout')
    expect(res.status).toBe(204)
    expect(admin.get(ADMIN_SESSION_COOKIE)).toBeUndefined()

    const rows = await pool.query('select 1 from admin_sessions where id = $1', [sessionId])
    expect(rows.rowCount).toBe(0)
    expect((await admin.getJson('/admin/auth/me')).status).toBe(401)
  })
})

describe('the two realms do not reach each other', () => {
  it('refuses a player session at the panel', async () => {
    if (!up) return
    const player = await newPlayer('realm')

    // Hand the panel exactly what the player has, under the panel's own cookie
    // name -- the shape a shared session table would let through.
    const impostor = adminClient()
    impostor.jar.set(ADMIN_SESSION_COOKIE, {
      value: player.client.get(SESSION_COOKIE)!.value,
      httpOnly: true,
    })

    const res = await impostor.getJson('/admin/players')
    expect(res.status).toBe(401)
  })

  it('refuses a panel session at the game', async () => {
    if (!up) return
    const admin = await newAdminClient()

    const player = new Client()
    player.jar.set(SESSION_COOKIE, {
      value: admin.get(ADMIN_SESSION_COOKIE)!.value,
      httpOnly: true,
    })

    const res = await player.getJson('/state')
    expect(res.status).toBe(401)
  })

  it('leaves the player API reachable', async () => {
    if (!up) return
    // The admin guards are mounted on /api/admin, not /api. Mounted one level
    // up they would gate every player request as well.
    const player = await newPlayer('reach')
    expect((await player.client.getJson('/state')).status).toBe(200)
  })

  it('404s an unknown admin path instead of falling through', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const res = await admin.getJson('/admin/yanlisyol')
    expect(res.status).toBe(404)
  })
})

describe('panel CSRF and origin gates', () => {
  it('refuses a mutation with no CSRF header', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const res = await admin.post(
      '/admin/players',
      { login: uniqueLogin('csrf'), password: PASSWORD, email: 'x@example.test' },
      { csrf: false },
    )
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('csrf_failed')
  })

  it('refuses a mutation sent from the game origin', async () => {
    if (!up) return
    const admin = await newAdminClient()
    // Everything else is valid: session, CSRF token, body. Only the Origin is
    // the game's -- the page that shares this cookie jar.
    const res = await admin.post(
      '/admin/players',
      { login: uniqueLogin('orig'), password: PASSWORD, email: 'x@example.test' },
      { origin: BASE_URL },
    )
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('bad_origin')
  })
})

describe('panel users', () => {
  it('creates one that can then sign in', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const email = uniqueAdminEmail('new')

    const created = await admin.post('/admin/admins', {
      email,
      name: 'Yeni Yönetici',
      password: PASSWORD,
      active: true,
    })
    expect(created.status).toBe(201)

    const listed = await admin.getJson('/admin/admins')
    expect(listed.body.rows.some((r: { email: string }) => r.email === email)).toBe(true)

    const signedIn = await adminClient().post('/admin/auth/login', { email, password: PASSWORD })
    expect(signedIn.status).toBe(200)
  })

  it('treats an address that differs only in case as taken', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const email = uniqueAdminEmail('case')
    expect(
      (await admin.post('/admin/admins', { email, name: 'A', password: PASSWORD, active: true }))
        .status,
    ).toBe(201)

    const again = await admin.post('/admin/admins', {
      email: email.toUpperCase(),
      name: 'B',
      password: PASSWORD,
      active: true,
    })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('email_taken')
  })

  it('drops the sessions of an admin whose password changes', async () => {
    if (!up) return
    const owner = await newAdminClient()
    const email = uniqueAdminEmail('pw')
    const created = await owner.post('/admin/admins', {
      email,
      name: 'Parola',
      password: PASSWORD,
      active: true,
    })

    const theirs = adminClient()
    expect((await theirs.post('/admin/auth/login', { email, password: PASSWORD })).status).toBe(200)

    const changed = await owner.patch(`/admin/admins/${created.body.id}`, {
      password: 'yeniparola123',
    })
    expect(changed.status).toBe(200)

    expect((await theirs.getJson('/admin/auth/me')).status).toBe(401)
    expect(
      (await adminClient().post('/admin/auth/login', { email, password: PASSWORD })).status,
    ).toBe(401)
  })

  it('ends a live session the moment the account is disabled', async () => {
    if (!up) return
    const owner = await newAdminClient()
    const email = uniqueAdminEmail('dis')
    const created = await owner.post('/admin/admins', {
      email,
      name: 'Kapanacak',
      password: PASSWORD,
      active: true,
    })

    const theirs = adminClient()
    await theirs.post('/admin/auth/login', { email, password: PASSWORD })
    expect((await theirs.getJson('/admin/auth/me')).status).toBe(200)

    await owner.patch(`/admin/admins/${created.body.id}`, { active: false })

    // requireAdmin re-reads `active` on every request, unlike requireSession.
    expect((await theirs.getJson('/admin/auth/me')).status).toBe(401)
  })

  it('refuses to delete yourself while another admin is active', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const me = await admin.getJson('/admin/auth/me')

    // A second active admin, so "last way in" is not what is being tested here.
    const created = await admin.post('/admin/admins', {
      email: uniqueAdminEmail('other'),
      name: 'Diğeri',
      password: PASSWORD,
      active: true,
    })
    expect(created.status).toBe(201)

    const self = await admin.del(`/admin/admins/${me.body.admin.id}`)
    expect(self.status).toBe(409)
    expect(self.body.error).toBe('self_delete')
  })

  /**
   * The panel must not be able to remove its own last way in.
   *
   * Deliberately never deletes the seeded account -- a crash between a delete
   * and a re-create would leave the developer locked out of the panel with only
   * psql to get back in. Instead every *other* admin is cleared first, so the
   * seeded one is genuinely the last, and then both destructive operations are
   * attempted against it and expected to bounce.
   */
  it('refuses to delete or disable the last active super admin', async () => {
    if (!up) return
    await pool.query(`delete from admin_users where email <> $1`, [SEEDED_ADMIN.email])

    const admin = await newAdminClient()
    const me = await admin.getJson('/admin/auth/me')
    const id = me.body.admin.id

    const deleted = await admin.del(`/admin/admins/${id}`)
    expect(deleted.status).toBe(409)
    expect(deleted.body.error).toBe('last_super_admin')

    const disabled = await admin.patch(`/admin/admins/${id}`, { active: false })
    expect(disabled.status).toBe(409)
    expect(disabled.body.error).toBe('last_super_admin')

    // Still there, still usable.
    const { rows } = await pool.query('select active from admin_users where id = $1', [id])
    expect(rows[0].active).toBe(true)
    expect((await adminClient().post('/admin/auth/login', SEEDED_ADMIN)).status).toBe(200)
  })
})

describe('players', () => {
  it('lists a player with their town count and ban state', async () => {
    if (!up) return
    const player = await newPlayer('list')
    const admin = await newAdminClient()

    const res = await admin.getJson(`/admin/players?q=${player.login}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.rows[0].login).toBe(player.login)
    expect(res.body.rows[0].townCount).toBe(1)
    expect(res.body.rows[0].banned).toBe(false)
  })

  it('pages and sorts without letting an unknown sort key through', async () => {
    if (!up) return
    await newPlayer('page1')
    await newPlayer('page2')
    const admin = await newAdminClient()

    const page = await admin.getJson('/admin/players?perPage=1&sort=login&dir=asc')
    expect(page.status).toBe(200)
    expect(page.body.rows).toHaveLength(1)
    expect(page.body.total).toBeGreaterThan(1)

    const bad = await admin.getJson('/admin/players?sort=login;drop%20table')
    expect(bad.status).toBe(400)
  })

  /**
   * Searching by id, which is how a moderator gets from `#928` in the audit log
   * to the account -- and the reason the id branch is a regex in SQL rather
   * than a `Number()` in JS: `'999999999999'::int` does not match nothing, it
   * aborts the statement with `integer out of range`, turning a search box into
   * a 500.
   */
  it('finds a player by id, and survives a number no id could be', async () => {
    if (!up) return
    const player = await newPlayer('byid')
    const admin = await newAdminClient()

    // A login that happens to contain the id's digits would let the ILIKE
    // branch satisfy this test with no id branch at all. `uniqueLogin` is a
    // dozen digits of pid and clock, so this fires on roughly one run in a
    // hundred; renaming is cheaper than a test that can pass for the wrong
    // reason.
    let login = player.login
    for (let i = 0; i < 5 && login.includes(String(player.userId)); i++) {
      login = uniqueLogin('byid')
      expect((await admin.patch(`/admin/players/${player.userId}`, { login })).status).toBe(200)
    }
    expect(login).not.toContain(String(player.userId))

    const byId = await admin.getJson(`/admin/players?q=${player.userId}&perPage=100`)
    expect(byId.status).toBe(200)
    expect(byId.body.rows.some((r: { id: number }) => r.id === player.userId)).toBe(true)

    const huge = await admin.getJson('/admin/players?q=999999999999')
    expect(huge.status).toBe(200)
    expect(huge.body.rows).toEqual([])
    expect(huge.body.total).toBe(0)

    // The text branches still work: the id one is an addition, not a swap.
    const byName = await admin.getJson(`/admin/players?q=${login}`)
    expect(byName.body.total).toBe(1)
    expect(byName.body.rows[0].id).toBe(player.userId)
  })

  it('creates a playable account without signing the admin into it', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const login = uniqueLogin('made')

    const created = await admin.post('/admin/players', {
      login,
      password: PASSWORD,
      email: `${login}@example.test`,
    })
    expect(created.status).toBe(201)
    expect(created.body.townId).toBeGreaterThan(0)

    // The whole starting graph, as register() builds it.
    const towns = await pool.query('select count(*)::int as n from towns where user_id = $1', [
      created.body.userId,
    ])
    expect(towns.rows[0].n).toBe(1)
    const hall = await pool.query(
      `select type, level from town_buildings where town_id = $1 and slot = 0`,
      [created.body.townId],
    )
    expect(hall.rows[0]).toMatchObject({ type: 1, level: 1 })
    const notes = await pool.query('select count(*)::int as n from notes where user_id = $1', [
      created.body.userId,
    ])
    expect(notes.rows[0].n).toBe(1)

    // The admin's jar must not have gained a player session -- with a shared
    // cookie jar that would clobber their own.
    expect(admin.get(SESSION_COOKIE)).toBeUndefined()

    // And the account really works.
    const player = new Client()
    expect((await player.post('/auth/login', { login, password: PASSWORD })).status).toBe(200)
    expect((await player.getJson('/state')).status).toBe(200)
  })

  it('rejects a duplicate login and a short password with their own codes', async () => {
    if (!up) return
    const existing = await newPlayer('dup')
    const admin = await newAdminClient()

    const duplicate = await admin.post('/admin/players', {
      login: existing.login,
      password: PASSWORD,
      email: 'dup@example.test',
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toBe('name_taken')

    const short = await admin.post('/admin/players', {
      login: uniqueLogin('short'),
      password: 'kısa',
      email: 'short@example.test',
    })
    expect(short.status).toBe(400)
    expect(short.body.error).toBe('password_length')
  })

  it('renames a player and refuses a name already in use', async () => {
    if (!up) return
    const player = await newPlayer('ren')
    const other = await newPlayer('ren2')
    const admin = await newAdminClient()

    const renamed = uniqueLogin('renamed')
    expect((await admin.patch(`/admin/players/${player.userId}`, { login: renamed })).status).toBe(
      200,
    )
    const after = await pool.query('select login from users where id = $1', [player.userId])
    expect(after.rows[0].login).toBe(renamed)

    const clash = await admin.patch(`/admin/players/${player.userId}`, { login: other.login })
    expect(clash.status).toBe(409)
    expect(clash.body.error).toBe('name_taken')
  })
})

describe('bans', () => {
  it('cuts off the live session and blocks the next login', async () => {
    if (!up) return
    const player = await newPlayer('ban')
    expect((await player.client.getJson('/state')).status).toBe(200)

    const admin = await newAdminClient()
    const banned = await admin.post(`/admin/players/${player.userId}/ban`, {
      permanent: false,
      seconds: 3600,
      reason: 'tick zorlama',
    })
    expect(banned.status).toBe(200)
    expect(banned.body.sessionsRevoked).toBeGreaterThan(0)

    // Without the session sweep the ban would do nothing for seven days:
    // requireSession never joins `users`.
    expect((await player.client.getJson('/state')).status).toBe(401)

    const login = await new Client().post('/auth/login', {
      login: player.login,
      password: PASSWORD,
    })
    expect(login.status).toBe(403)
    expect(login.body.error).toBe('account_blocked')
    expect(login.body.reason).toBe('tick zorlama')
    expect(login.body.until).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('writes a temporary ban for the duration asked for', async () => {
    if (!up) return
    const player = await newPlayer('bantime')
    const admin = await newAdminClient()
    await admin.post(`/admin/players/${player.userId}/ban`, {
      permanent: false,
      seconds: 3600,
      reason: '',
    })

    const { rows } = await pool.query(
      `select blocked_until,
              blocked_until between now() + interval '55 minutes' and now() + interval '65 minutes'
                as about_an_hour
         from users where id = $1`,
      [player.userId],
    )
    expect(rows[0].about_an_hour).toBe(true)
  })

  it('stores a permanent ban as a finite instant', async () => {
    if (!up) return
    const player = await newPlayer('perma')
    const admin = await newAdminClient()

    const banned = await admin.post(`/admin/players/${player.userId}/ban`, {
      permanent: true,
      reason: 'kalıcı',
    })
    expect(banned.status).toBe(200)
    expect(banned.body.permanent).toBe(true)
    // `infinity` would arrive here as Infinity, and verifyLogin would read it
    // as an *elapsed* ban -- clearing it and letting the account back in.
    expect(Number.isFinite(banned.body.blockedUntil)).toBe(true)

    const login = await new Client().post('/auth/login', {
      login: player.login,
      password: PASSWORD,
    })
    expect(login.status).toBe(403)

    const listed = await admin.getJson(`/admin/players?q=${player.login}`)
    expect(listed.body.rows[0].permanentBan).toBe(true)
  })

  it('lifts a ban and lets the player back in', async () => {
    if (!up) return
    const player = await newPlayer('unban')
    const admin = await newAdminClient()
    await admin.post(`/admin/players/${player.userId}/ban`, {
      permanent: true,
      reason: 'geçici olarak',
    })

    expect((await admin.post(`/admin/players/${player.userId}/unban`)).status).toBe(200)

    const { rows } = await pool.query(
      'select blocked_until, blocked_reason from users where id = $1',
      [player.userId],
    )
    expect(rows[0].blocked_until).toBeNull()
    expect(rows[0].blocked_reason).toBeNull()

    const login = await new Client().post('/auth/login', {
      login: player.login,
      password: PASSWORD,
    })
    expect(login.status).toBe(200)
  })

  it('records every ban in the audit log', async () => {
    if (!up) return
    const player = await newPlayer('audit')
    const admin = await newAdminClient()
    await admin.post(`/admin/players/${player.userId}/ban`, {
      permanent: false,
      seconds: 60,
      reason: 'kayıt',
    })

    const { rows } = await pool.query(
      `select action, target_type, meta from admin_audit_log
        where target_id = $1 and action = 'player.ban'`,
      [player.userId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].target_type).toBe('player')
    expect(JSON.parse(rows[0].meta).reason).toBe('kayıt')
  })
})

describe('players cannot be deleted from the panel', () => {
  it('has no delete route, and the account survives the attempt', async () => {
    if (!up) return
    const player = await newPlayer('keep')
    const admin = await newAdminClient()

    const res = await admin.del(`/admin/players/${player.userId}`)
    expect([404, 405]).toContain(res.status)

    const { rows } = await pool.query('select 1 from users where id = $1', [player.userId])
    expect(rows).toHaveLength(1)
  })
})

describe('resource grants', () => {
  it('survives the player reading their own state afterwards', async () => {
    if (!up) return
    const player = await newPlayer('grant')
    const admin = await newAdminClient()

    const before = await admin.getJson(`/admin/players/${player.userId}/resources`)
    expect(before.status).toBe(200)
    const town = before.body.towns[0]
    expect(town.active).toBe(true)
    expect(town.capacity).toBeGreaterThan(0)

    const res = await admin.post(`/admin/players/${player.userId}/resources`, {
      townIds: [town.id],
      // Wood, not wine: the tavern burns wine every tick, so a wine assertion
      // would race the clock. 500 + 300 is comfortably under the 1500 cap.
      town: { wood: { mode: 'add', value: 300 } },
      account: { gold: { mode: 'set', value: 12345 } },
      note: 'telafi',
    })
    expect(res.status).toBe(200)
    const granted = res.body.towns[0].after.wood

    // The player's own request re-runs the tick and writes the whole graph
    // back: a clobber would return the pre-grant number, a double-apply would
    // return 300 more than we asked for.
    const state = await player.client.getJson('/state')
    expect(state.status).toBe(200)
    const now = state.body.state.towns.find((t: { id: number }) => t.id === town.id).resources.wood
    expect(now).toBeGreaterThanOrEqual(granted)
    expect(now).toBeLessThan(granted + 100)
    expect(state.body.state.user.gold).toBeGreaterThanOrEqual(12345)
  })

  it('clamps to the warehouse and says how many towns it clamped', async () => {
    if (!up) return
    const player = await newPlayer('clamp')
    const admin = await newAdminClient()
    const before = await admin.getJson(`/admin/players/${player.userId}/resources`)
    const town = before.body.towns[0]

    const res = await admin.post(`/admin/players/${player.userId}/resources`, {
      townIds: [town.id],
      town: { wood: { mode: 'set', value: 999_999 } },
    })
    expect(res.status).toBe(200)
    expect(res.body.clampedTowns).toBe(1)
    expect(res.body.towns[0].clamped).toContain('wood')
    expect(res.body.towns[0].after.wood).toBe(town.capacity)

    // The database, not just the JSON.
    const { rows } = await pool.query('select wood from towns where id = $1', [town.id])
    expect(Number(rows[0].wood)).toBe(town.capacity)
  })

  it('does not make the player look like they just logged in', async () => {
    if (!up) return
    const player = await newPlayer('visit')
    const admin = await newAdminClient()

    const before = await pool.query('select last_visit_at from users where id = $1', [player.userId])
    await admin.post(`/admin/players/${player.userId}/resources`, {
      account: { ambrosia: { mode: 'add', value: 10 } },
    })
    const after = await pool.query('select last_visit_at from users where id = $1', [player.userId])
    // `savePlayerState` writes `last_visit_at = now()` on every call; the grant
    // puts it back, or the panel's own "Son giriş" column and espionage's
    // online flag would both lie.
    expect(after.rows[0].last_visit_at.getTime()).toBe(before.rows[0].last_visit_at.getTime())

    // ...and the assertion above is not vacuous: a real visit does move it.
    await player.client.getJson('/state')
    const visited = await pool.query('select last_visit_at from users where id = $1', [
      player.userId,
    ])
    expect(visited.rows[0].last_visit_at.getTime()).toBeGreaterThan(
      after.rows[0].last_visit_at.getTime(),
    )
  })

  it('floors a subtraction at zero and refuses a negative set', async () => {
    if (!up) return
    const player = await newPlayer('floor')
    const admin = await newAdminClient()
    const before = await admin.getJson(`/admin/players/${player.userId}/resources`)
    const town = before.body.towns[0]

    const res = await admin.post(`/admin/players/${player.userId}/resources`, {
      townIds: [town.id],
      town: { wood: { mode: 'add', value: -999_999 } },
      account: { gold: { mode: 'add', value: -999_999 } },
    })
    expect(res.status).toBe(200)
    expect(res.body.towns[0].after.wood).toBe(0)
    expect(res.body.towns[0].floored).toContain('wood')
    expect(res.body.account.after.gold).toBe(0)

    const bad = await admin.post(`/admin/players/${player.userId}/resources`, {
      townIds: [town.id],
      town: { wood: { mode: 'set', value: -5 } },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('invalid_input')
  })

  it('keeps the gold score in step', async () => {
    if (!up) return
    const player = await newPlayer('score')
    const admin = await newAdminClient()

    await admin.post(`/admin/players/${player.userId}/resources`, {
      account: { gold: { mode: 'set', value: 7777 } },
    })

    // The tick copies gold into the score *before* the grant runs, so without
    // the explicit sync the highscore keeps the old figure until the player's
    // next request.
    const { rows } = await pool.query(
      `select value from user_scores where user_id = $1 and category = 'gold'`,
      [player.userId],
    )
    expect(Number(rows[0].value)).toBe(7777)
  })

  it('unwinds the whole grant when a town belongs to somebody else', async () => {
    if (!up) return
    const player = await newPlayer('mine')
    const stranger = await newPlayer('theirs')
    const admin = await newAdminClient()

    const before = await admin.getJson(`/admin/players/${player.userId}/resources`)
    const mine = before.body.towns[0]
    const strangerTowns = await admin.getJson(`/admin/players/${stranger.userId}/resources`)
    const theirs = strangerTowns.body.towns[0]

    const res = await admin.post(`/admin/players/${player.userId}/resources`, {
      townIds: [mine.id, theirs.id],
      town: { marble: { mode: 'add', value: 500 } },
    })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('unknown_town')

    // Nothing half-applied: the towns are resolved before any of them is
    // touched, and the transaction covers the rest.
    const { rows } = await pool.query('select marble from towns where id = $1', [mine.id])
    expect(Number(rows[0].marble)).toBe(mine.resources.marble)
  })

  it('reads without writing', async () => {
    if (!up) return
    const player = await newPlayer('read')
    const admin = await newAdminClient()

    const before = await pool.query(
      `select u.last_visit_at, t.last_update
         from users u join towns t on t.user_id = u.id where u.id = $1`,
      [player.userId],
    )
    await admin.getJson(`/admin/players/${player.userId}/resources`)
    const after = await pool.query(
      `select u.last_visit_at, t.last_update
         from users u join towns t on t.user_id = u.id where u.id = $1`,
      [player.userId],
    )

    // `advance()` ticks in memory; only `persist()` writes, and the read does
    // not call it. This fails the moment somebody "helpfully" adds one.
    expect(after.rows[0].last_visit_at.getTime()).toBe(before.rows[0].last_visit_at.getTime())
    expect(after.rows[0].last_update.getTime()).toBe(before.rows[0].last_update.getTime())
  })

  it('refuses an empty grant before it costs a tick', async () => {
    if (!up) return
    const player = await newPlayer('empty')
    const admin = await newAdminClient()

    const nothing = await admin.post(`/admin/players/${player.userId}/resources`, {})
    expect(nothing.status).toBe(400)
    expect(nothing.body.error).toBe('nothing_to_do')

    const noTowns = await admin.post(`/admin/players/${player.userId}/resources`, {
      town: { wood: { mode: 'add', value: 10 } },
    })
    expect(noTowns.status).toBe(400)
    expect(noTowns.body.error).toBe('no_towns_selected')
  })

  it('refuses a town that is still being founded', async () => {
    if (!up) return
    const player = await newPlayer('inactive')
    const admin = await newAdminClient()
    const before = await admin.getJson(`/admin/players/${player.userId}/resources`)
    const town = before.body.towns[0]

    // A town hall at level 0 is a colony in transit: the tick skips it and
    // `derive()` has no entry, so there is no capacity to clamp against.
    await pool.query(
      'update town_buildings set level = 0 where town_id = $1 and slot = 0',
      [town.id],
    )
    const res = await admin.post(`/admin/players/${player.userId}/resources`, {
      townIds: [town.id],
      town: { wood: { mode: 'add', value: 10 } },
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('town_not_active')
  })

  it('records the grant in the audit log', async () => {
    if (!up) return
    const player = await newPlayer('audit')
    const admin = await newAdminClient()
    const before = await admin.getJson(`/admin/players/${player.userId}/resources`)

    await admin.post(`/admin/players/${player.userId}/resources`, {
      townIds: [before.body.towns[0].id],
      town: { sulfur: { mode: 'add', value: 42 } },
      note: 'etkinlik ödülü',
    })

    const { rows } = await pool.query(
      `select action, meta from admin_audit_log
        where target_id = $1 and action = 'player.grant_resources' order by id desc limit 1`,
      [player.userId],
    )
    expect(rows).toHaveLength(1)
    const meta = JSON.parse(rows[0].meta)
    expect(meta.townIds).toEqual([before.body.towns[0].id])
    expect(meta.note).toBe('etkinlik ödülü')
  })

  it('is refused without the panel origin', async () => {
    if (!up) return
    const player = await newPlayer('origin')
    const admin = await newAdminClient()
    const res = await admin.post(
      `/admin/players/${player.userId}/resources`,
      { account: { gold: { mode: 'add', value: 1 } } },
      { origin: null },
    )
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('bad_origin')
  })
})

describe('the audit log reads back', () => {
  it('returns the entry a ban wrote, with the acting admin attached', async () => {
    if (!up) return
    const player = await newPlayer('log')
    const admin = await newAdminClient()
    await admin.post(`/admin/players/${player.userId}/ban`, {
      permanent: false,
      seconds: 3600,
      reason: 'kayıt testi',
    })

    const res = await admin.getJson(`/admin/audit?targetId=${player.userId}&action=player.ban`)
    expect(res.status).toBe(200)
    expect(res.body.rows).toHaveLength(1)
    expect(res.body.rows[0].admin.email).toBe(SEEDED_ADMIN.email)
    expect(res.body.rows[0].targetLabel).toBe(player.login)
    expect(res.body.rows[0].meta.reason).toBe('kayıt testi')
  })

  it('keeps an entry whose admin was deleted', async () => {
    if (!up) return
    const owner = await newAdminClient()
    const email = uniqueAdminEmail('gone')
    const created = await owner.post('/admin/admins', {
      email,
      name: 'Silinecek',
      password: PASSWORD,
      active: true,
    })

    const theirs = adminClient()
    await theirs.post('/admin/auth/login', { email, password: PASSWORD })
    const player = await newPlayer('orphan')
    await theirs.post(`/admin/players/${player.userId}/ban`, {
      permanent: true,
      reason: 'aktör silinecek',
    })

    expect((await owner.del(`/admin/admins/${created.body.id}`)).status).toBe(204)

    const res = await owner.getJson(`/admin/audit?targetId=${player.userId}`)
    // `admin_user_id` is `on delete set null`: an inner join, or a cascade,
    // would delete exactly the history this table exists to keep.
    expect(res.body.rows.length).toBeGreaterThan(0)
    expect(res.body.rows[0].admin).toBeNull()
    expect(res.body.rows[0].action).toBe('player.ban')
  })

  it('filters, pages and rejects an unknown action', async () => {
    if (!up) return
    const admin = await newAdminClient()

    const bad = await admin.getJson('/admin/audit?action=drop.table')
    expect(bad.status).toBe(400)

    const first = await admin.getJson('/admin/audit?perPage=1')
    const second = await admin.getJson('/admin/audit?perPage=1&page=1')
    expect(first.body.rows).toHaveLength(1)
    expect(second.body.rows).toHaveLength(1)
    // Ordered by id, not created_at: rows written in one transaction share
    // created_at to the microsecond and would page unstably.
    expect(first.body.rows[0].id).not.toBe(second.body.rows[0].id)
    expect(first.body.total).toBe(second.body.total)

    const future = await admin.getJson(`/admin/audit?from=${Math.floor(Date.now() / 1000) + 3600}`)
    expect(future.body.rows).toEqual([])
    expect(future.body.total).toBe(0)
  })
})

describe('the summary', () => {
  it('counts what the panel shows', async () => {
    if (!up) return
    const admin = await newAdminClient()
    const before = await admin.getJson('/admin/summary')
    expect(before.status).toBe(200)

    const player = await newPlayer('sum')
    await admin.post(`/admin/players/${player.userId}/ban`, {
      permanent: true,
      reason: 'sayaç',
    })

    const after = await admin.getJson('/admin/summary')
    expect(after.body.counts.players).toBeGreaterThan(before.body.counts.players)
    expect(after.body.counts.banned).toBeGreaterThan(before.body.counts.banned)
    expect(after.body.recent.length).toBeGreaterThan(0)
    expect(Array.isArray(after.body.top)).toBe(true)

    await admin.post(`/admin/players/${player.userId}/unban`)
    const unbanned = await admin.getJson('/admin/summary')
    expect(unbanned.body.counts.banned).toBe(before.body.counts.banned)
  })
})
