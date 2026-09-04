/**
 * The whole authenticated surface, over HTTP, through the dev proxy.
 *
 * Every assertion here is something a player can hit and nothing below this
 * line was covered before: cookie attributes, the CSRF gate, session
 * expiry, the ban check, and password reset.
 */

import { createHash } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CSRF_COOKIE,
  Client,
  PASSWORD,
  SESSION_COOKIE,
  cleanup,
  makePool,
  newPlayer,
  probe,
  uniqueLogin,
} from './harness.js'

let pool: pg.Pool
let up = false

beforeAll(async () => {
  pool = makePool()
  up = await probe(pool)
})

afterAll(async () => {
  if (up) await cleanup(pool)
  await pool?.end()
})

describe('registration', () => {
  it('creates the full starting graph and logs the player straight in', async () => {
    if (!up) return
    const p = await newPlayer('reg')

    expect(p.userId).toBeGreaterThan(0)
    expect(p.townId).toBeGreaterThan(0)

    const rows = await pool.query(
      `select
         (select count(*)::int from users where id = $1) as users,
         (select count(*)::int from towns where user_id = $1) as towns,
         (select count(*)::int from notes where user_id = $1) as notes,
         (select count(*)::int from town_buildings
            where town_id = $2 and slot = 0 and type = 1 and level = 1) as townhall,
         (select count(*)::int from sessions where user_id = $1) as sessions`,
      [p.userId, p.townId],
    )
    expect(rows.rows[0]).toMatchObject({
      users: 1,
      towns: 1,
      notes: 1,
      townhall: 1,
      sessions: 1,
    })

    // Logged in immediately, as the legacy did (izariam/controllers/main.php:188).
    const state = await p.client.getJson('/state')
    expect(state.status).toBe(200)
  })

  it('sets a httpOnly session cookie and a readable CSRF cookie', async () => {
    if (!up) return
    const p = await newPlayer('ck')

    const session = p.client.get(SESSION_COOKIE)
    const csrf = p.client.get(CSRF_COOKIE)
    expect(session).toBeDefined()
    expect(csrf).toBeDefined()

    expect(session!.httpOnly).toBe(true)
    // The client reads it out of document.cookie (apps/web/src/lib/api.ts:27-30).
    expect(csrf!.httpOnly).toBe(false)
    expect(session!.sameSite?.toLowerCase()).toBe('lax')
  })

  it('gives the CSRF cookie the same lifetime as the session', async () => {
    if (!up) return
    const p = await newPlayer('life')

    const session = p.client.get(SESSION_COOKIE)!
    const csrf = p.client.get(CSRF_COOKIE)!

    // A CSRF cookie with no Max-Age dies when the browser closes while the
    // session cookie lives seven days, after which every mutation 403s and
    // nothing re-issues the token.
    expect(csrf.maxAge, 'CSRF cookie must not be a browser-session cookie').toBeDefined()
    expect(csrf.maxAge!).toBeGreaterThanOrEqual(session.maxAge! - 5)
  })

  it('rejects a duplicate login', async () => {
    if (!up) return
    const p = await newPlayer('dup')
    const res = await new Client().post('/auth/register', {
      login: p.login,
      password: PASSWORD,
      email: 'dup@example.test',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('name_taken')
  })

  it('rejects a duplicate login differing only in case', async () => {
    if (!up) return
    const p = await newPlayer('case')
    const res = await new Client().post('/auth/register', {
      login: p.login.toUpperCase(),
      password: PASSWORD,
      email: 'case@example.test',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('name_taken')
  })

  // The client translates name_length / password_length / invalid_email
  // (apps/web/src/screens/StartPage.tsx:36-43). Anything else reaches the page
  // as a raw code.
  const translatable = ['name_length', 'password_length', 'invalid_email', 'name_taken', 'world_full']

  it.each([
    ['a short login', { login: 'ab', password: PASSWORD, email: 'a@b.co' }, 'name_length'],
    ['a long login', { login: 'x'.repeat(31), password: PASSWORD, email: 'a@b.co' }, 'name_length'],
    ['a short password', { login: 'validname', password: 'short', email: 'a@b.co' }, 'password_length'],
    [
      'a long password',
      { login: 'validname', password: 'x'.repeat(31), email: 'a@b.co' },
      'password_length',
    ],
    ['a malformed email', { login: 'validname', password: PASSWORD, email: 'nope' }, 'invalid_email'],
  ])('reports %s with a code the client can translate', async (_label, body, expected) => {
    if (!up) return
    const res = await new Client().post('/auth/register', body)
    expect(res.status).toBe(400)
    expect(translatable, `"${res.body.error}" has no catalog entry`).toContain(res.body.error)
    expect(res.body.error).toBe(expected)
  })

  it('trims the login before measuring it', async () => {
    if (!up) return
    const res = await new Client().post('/auth/register', {
      login: '  ab  ',
      password: PASSWORD,
      email: 'a@b.co',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('name_length')
  })
})

describe('login', () => {
  it('accepts the right password and issues both cookies', async () => {
    if (!up) return
    const p = await newPlayer('li')

    const fresh = new Client()
    const res = await fresh.post('/auth/login', { login: p.login, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.userId).toBe(p.userId)
    expect(fresh.get(SESSION_COOKIE)).toBeDefined()
    expect(fresh.get(CSRF_COOKIE)).toBeDefined()

    expect((await fresh.getJson('/state')).status).toBe(200)
  })

  it('is case-insensitive on the login', async () => {
    if (!up) return
    const p = await newPlayer('ci')
    const res = await new Client().post('/auth/login', {
      login: p.login.toUpperCase(),
      password: PASSWORD,
    })
    expect(res.status).toBe(200)
  })

  it.each([
    ['a wrong password', (login: string) => ({ login, password: 'wrongwrong1' })],
    ['an unknown account', () => ({ login: 'e2e_nobody_here', password: PASSWORD })],
  ])('rejects %s with the same message', async (_label, make) => {
    if (!up) return
    const p = await newPlayer('bad')
    const res = await new Client().post('/auth/login', make(p.login))
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('bad_credentials')
  })

  it('upgrades a migrated md5 password to argon2id on first use', async () => {
    if (!up) return
    const login = uniqueLogin('md5')
    const md5 = createHash('md5').update(PASSWORD).digest('hex')
    const { rows } = await pool.query(
      `insert into users (login, email, password_hash, legacy_password_md5, register_complete)
       values ($1, $2, '', $3, true) returning id`,
      [login, `${login}@example.test`, md5],
    )
    const userId = Number(rows[0].id)

    const res = await new Client().post('/auth/login', { login, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.userId).toBe(userId)

    const after = await pool.query(
      'select password_hash, legacy_password_md5 from users where id = $1',
      [userId],
    )
    expect(after.rows[0].legacy_password_md5).toBeNull()
    expect(String(after.rows[0].password_hash)).toMatch(/^\$argon2id\$/)
  })

  it('refuses a blocked account and says until when', async () => {
    if (!up) return
    const p = await newPlayer('ban')
    await pool.query(
      `update users set blocked_until = now() + interval '1 hour', blocked_reason = $2 where id = $1`,
      [p.userId, 'pushing the tick'],
    )

    const res = await new Client().post('/auth/login', { login: p.login, password: PASSWORD })
    // The legacy checked this on every login (izariam/models/player_model.php:270-272).
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('account_blocked')
    expect(res.body.until).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(res.body.reason).toBe('pushing the tick')
  })

  it('lets an expired block through and clears it', async () => {
    if (!up) return
    const p = await newPlayer('unban')
    await pool.query(
      `update users set blocked_until = now() - interval '1 hour', blocked_reason = 'old' where id = $1`,
      [p.userId],
    )

    const res = await new Client().post('/auth/login', { login: p.login, password: PASSWORD })
    expect(res.status).toBe(200)

    const after = await pool.query(
      'select blocked_until, blocked_reason from users where id = $1',
      [p.userId],
    )
    expect(after.rows[0].blocked_until).toBeNull()
    expect(after.rows[0].blocked_reason).toBeNull()
  })
})

describe('session and CSRF gates', () => {
  it('401s a read with no session cookie', async () => {
    if (!up) return
    const res = await new Client().getJson('/state')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('not_authenticated')
  })

  it('401s a read whose session has expired', async () => {
    if (!up) return
    const p = await newPlayer('exp')
    await pool.query(`update sessions set expires_at = now() - interval '1 second' where user_id = $1`, [
      p.userId,
    ])
    const res = await p.client.getJson('/state')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('session_expired')
  })

  it('403s a mutation with no CSRF header', async () => {
    if (!up) return
    const p = await newPlayer('csrf')
    const res = await p.client.request('POST', '/actions/skipTutorial', {}, { csrf: false })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('csrf_failed')
  })

  it('lets a session that lost its CSRF cookie fetch a new one', async () => {
    if (!up) return
    const p = await newPlayer('reissue')
    // What a browser restart does to a cookie with no Max-Age.
    p.client.forget(CSRF_COOKIE)

    const refreshed = await p.client.getJson('/auth/csrf')
    expect(refreshed.status).toBe(200)
    expect(p.client.get(CSRF_COOKIE)).toBeDefined()

    const act = await p.client.post('/actions/skipTutorial')
    expect(act.status).toBe(200)
  })

  it('will not hand a CSRF token to an anonymous caller', async () => {
    if (!up) return
    const res = await new Client().getJson('/auth/csrf')
    expect(res.status).toBe(401)
  })

  it('guards PUT /notes with CSRF like every other mutation', async () => {
    if (!up) return
    const p = await newPlayer('notes')
    const res = await p.client.request('PUT', '/notes', { text: 'hello' }, { csrf: false })
    expect(res.status).toBe(403)

    const ok = await p.client.put('/notes', { text: 'hello' })
    expect(ok.status).toBe(200)
  })
})

describe('logout', () => {
  it('destroys the session and clears both cookies', async () => {
    if (!up) return
    const p = await newPlayer('out')
    const res = await p.client.post('/auth/logout')
    expect(res.status).toBe(204)
    expect(p.client.get(SESSION_COOKIE)).toBeUndefined()
    expect(p.client.get(CSRF_COOKIE)).toBeUndefined()

    const { rows } = await pool.query('select count(*) as n from sessions where user_id = $1', [
      p.userId,
    ])
    expect(Number(rows[0].n)).toBe(0)

    expect((await p.client.getJson('/state')).status).toBe(401)
  })

  it('refuses an anonymous logout instead of deleting whatever id it is handed', async () => {
    if (!up) return
    const victim = await newPlayer('victim')
    const sessionId = victim.client.get(SESSION_COOKIE)!.value

    const attacker = new Client()
    attacker.jar.set(SESSION_COOKIE, { value: 'not-a-real-session', httpOnly: true })
    const res = await attacker.post('/auth/logout')
    expect(res.status).toBe(401)

    const { rows } = await pool.query('select count(*) as n from sessions where id = $1', [sessionId])
    expect(Number(rows[0].n)).toBe(1)
  })
})

describe('password reset', () => {
  it('issues a single-use token that changes the password and drops old sessions', async () => {
    if (!up) return
    const p = await newPlayer('reset')
    const oldSession = p.client.get(SESSION_COOKIE)!.value

    const forgot = await new Client().post('/auth/forgot-password', { email: p.email })
    expect(forgot.status).toBe(200)
    expect(forgot.body.ok).toBe(true)
    // No mail transport here, so development mode hands the token back.
    const token = forgot.body.token
    expect(typeof token).toBe('string')

    const next = 'yenisifre123'
    const reset = await new Client().post('/auth/reset-password', { token, password: next })
    expect(reset.status).toBe(200)

    // Old password dead, new one live.
    expect((await new Client().post('/auth/login', { login: p.login, password: PASSWORD })).status).toBe(401)
    expect((await new Client().post('/auth/login', { login: p.login, password: next })).status).toBe(200)

    // Every session the account had is gone.
    const { rows } = await pool.query('select count(*) as n from sessions where id = $1', [oldSession])
    expect(Number(rows[0].n)).toBe(0)

    // Token cannot be replayed.
    const replay = await new Client().post('/auth/reset-password', { token, password: 'baskasifre1' })
    expect(replay.status).toBe(400)
    expect(replay.body.error).toBe('invalid_token')
  })

  it('does not reveal whether an email is registered', async () => {
    if (!up) return
    const known = await newPlayer('enum')
    const hit = await new Client().post('/auth/forgot-password', { email: known.email })
    const miss = await new Client().post('/auth/forgot-password', {
      email: 'e2e-nobody@example.test',
    })

    expect(hit.status).toBe(miss.status)
    expect(hit.body.ok).toBe(true)
    expect(miss.body.ok).toBe(true)
    expect(miss.body.token).toBeUndefined()
  })

  it('refuses an expired token', async () => {
    if (!up) return
    const p = await newPlayer('expired')
    const forgot = await new Client().post('/auth/forgot-password', { email: p.email })
    await pool.query(
      `update password_resets set expires_at = now() - interval '1 second' where user_id = $1`,
      [p.userId],
    )

    const res = await new Client().post('/auth/reset-password', {
      token: forgot.body.token,
      password: 'yenisifre123',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_token')
  })

  it('applies the same password rules as registration', async () => {
    if (!up) return
    const p = await newPlayer('weak')
    const forgot = await new Client().post('/auth/forgot-password', { email: p.email })
    const res = await new Client().post('/auth/reset-password', {
      token: forgot.body.token,
      password: 'short',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('password_length')
  })
})
