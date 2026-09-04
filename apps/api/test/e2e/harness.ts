/**
 * Shared harness for the end-to-end suites.
 *
 * These talk HTTP to a running stack rather than importing the handlers, which
 * is the point: `state.roundtrip.test.ts` already covers the persistence
 * boundary by calling `register()` directly, and it passes even when the
 * session cookie, the CSRF gate or the Vite proxy is broken. Everything the
 * browser depends on lives above that line.
 *
 * The default base URL is the *web* origin, not the API's, so the dev proxy is
 * inside the test path exactly as it is for a player.
 */

import pg from 'pg'

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5175'
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://izariam:izariam@127.0.0.1:5432/izariam'

export const SESSION_COOKIE = 'izariam_session'
export const CSRF_COOKIE = 'izariam_csrf'

/**
 * Every login this suite creates starts with this, so a run can clean up after
 * itself with one statement and never touch a real account.
 */
export const E2E_PREFIX = 'e2e'

export interface Cookie {
  value: string
  /** Seconds, from Max-Age or a converted Expires. Undefined = session cookie. */
  maxAge?: number
  httpOnly: boolean
  sameSite?: string
  path?: string
}

export interface Response<T = unknown> {
  status: number
  body: T
  headers: Headers
}

function parseSetCookie(line: string): [string, Cookie] | null {
  const [pair, ...attrs] = line.split(';')
  const eq = pair?.indexOf('=') ?? -1
  if (!pair || eq < 0) return null
  const name = pair.slice(0, eq).trim()
  const value = pair.slice(eq + 1).trim()

  const cookie: Cookie = { value, httpOnly: false }
  for (const raw of attrs) {
    const [k, v] = raw.split('=')
    const key = k?.trim().toLowerCase()
    if (key === 'max-age') cookie.maxAge = Number(v)
    else if (key === 'expires' && cookie.maxAge === undefined) {
      const at = Date.parse(v?.trim() ?? '')
      if (!Number.isNaN(at)) cookie.maxAge = Math.round((at - Date.now()) / 1000)
    } else if (key === 'httponly') cookie.httpOnly = true
    else if (key === 'samesite') cookie.sameSite = v?.trim()
    else if (key === 'path') cookie.path = v?.trim()
  }
  return [name, cookie]
}

/**
 * A browser, near enough: it keeps a cookie jar, echoes the CSRF cookie into
 * the `x-csrf-token` header on non-GET requests, and drops cookies the server
 * clears -- the same three rules `apps/web/src/lib/api.ts` relies on.
 */
export class Client {
  readonly jar = new Map<string, Cookie>()

  /**
   * The panel is a second origin with its own CSRF cookie, so both are
   * parameters. Defaults keep every existing `new Client()` behaving as before.
   *
   * `origin` matters because the admin API refuses a mutation whose `Origin`
   * header is not the panel's -- a browser always sends one, and Node's fetch
   * never does.
   */
  constructor(
    readonly baseUrl: string = BASE_URL,
    readonly csrfCookie: string = CSRF_COOKIE,
    readonly origin?: string,
  ) {}

  cookieHeader(): string {
    return [...this.jar].map(([name, c]) => `${name}=${c.value}`).join('; ')
  }

  get(name: string): Cookie | undefined {
    return this.jar.get(name)
  }

  /** Forget a cookie without telling the server -- what closing a browser does
   *  to a cookie that carries no Max-Age. */
  forget(name: string) {
    this.jar.delete(name)
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    opts: { csrf?: boolean; origin?: string | null } = {},
  ): Promise<Response<T>> {
    const headers = new Headers()
    if (body !== undefined) headers.set('content-type', 'application/json')
    const jarCookies = this.cookieHeader()
    if (jarCookies) headers.set('cookie', jarCookies)

    const csrf = this.jar.get(this.csrfCookie)
    const wantsCsrf = opts.csrf ?? method !== 'GET'
    if (csrf && wantsCsrf) headers.set('x-csrf-token', csrf.value)

    // `origin: null` on a call means "send none", which is what a non-browser
    // caller looks like to the admin API.
    const origin = opts.origin === undefined ? this.origin : opts.origin
    if (origin) headers.set('origin', origin)

    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    })

    for (const line of res.headers.getSetCookie?.() ?? []) {
      const parsed = parseSetCookie(line)
      if (!parsed) continue
      const [name, cookie] = parsed
      // `res.clearCookie` sends an empty value with an expiry in the past.
      if (cookie.value === '' || (cookie.maxAge !== undefined && cookie.maxAge <= 0)) {
        this.jar.delete(name)
      } else {
        this.jar.set(name, cookie)
      }
    }

    const text = await res.text()
    let parsed: unknown = undefined
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    return { status: res.status, body: parsed as T, headers: res.headers }
  }

  post<T = any>(path: string, body?: unknown, opts?: { csrf?: boolean; origin?: string | null }) {
    return this.request<T>('POST', path, body ?? {}, opts)
  }
  patch<T = any>(path: string, body?: unknown, opts?: { csrf?: boolean; origin?: string | null }) {
    return this.request<T>('PATCH', path, body ?? {}, opts)
  }
  del<T = any>(path: string, opts?: { csrf?: boolean; origin?: string | null }) {
    return this.request<T>('DELETE', path, undefined, opts)
  }
  put<T = any>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body ?? {})
  }
  getJson<T = any>(path: string) {
    return this.request<T>('GET', path)
  }
}

/** Unique per run, mirroring `state.roundtrip.test.ts:37-40`. */
let counter = 0
export function uniqueLogin(prefix: string): string {
  counter++
  return `${E2E_PREFIX}${prefix}${process.pid}${counter}${Math.floor(performance.now())}`.slice(
    0,
    30,
  )
}

export const PASSWORD = 'parola12345'

export interface Player {
  client: Client
  login: string
  email: string
  userId: number
  townId: number
}

/** Register through HTTP and return an authenticated client. */
export async function newPlayer(prefix = 'p'): Promise<Player> {
  const client = new Client()
  const login = uniqueLogin(prefix)
  const email = `${login}@example.test`
  const res = await client.post<{ userId: number; townId: number }>('/auth/register', {
    login,
    password: PASSWORD,
    email,
  })
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return { client, login, email, userId: res.body.userId, townId: res.body.townId }
}

// ---------------------------------------------------------------------------
// The staff panel
// ---------------------------------------------------------------------------

export const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL ?? 'http://127.0.0.1:5174'
export const ADMIN_SESSION_COOKIE = 'izariam_admin_session'
export const ADMIN_CSRF_COOKIE = 'izariam_admin_csrf'

/** Seeded by `packages/db/src/seed.ts`, and the only account that starts with
 *  panel access. */
export const SEEDED_ADMIN = {
  email: process.env.ADMIN_SEED_EMAIL ?? 'admin@izariam.local',
  password: process.env.ADMIN_SEED_PASSWORD ?? '1q2w3e4r*-',
}

/** A client that talks to the panel origin, echoes the admin CSRF cookie and
 *  sends the `Origin` the admin API insists on. */
export function adminClient(): Client {
  return new Client(ADMIN_BASE_URL, ADMIN_CSRF_COOKIE, ADMIN_BASE_URL)
}

export async function newAdminClient(): Promise<Client> {
  const client = adminClient()
  const res = await client.post('/admin/auth/login', SEEDED_ADMIN)
  if (res.status !== 200) {
    throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return client
}

/** Admin accounts are identified by email, so the cleanup prefix goes there. */
export function uniqueAdminEmail(prefix = 'a'): string {
  counter++
  return `${E2E_PREFIX}${prefix}${process.pid}${counter}${Math.floor(performance.now())}@example.test`
}

export function makePool(): pg.Pool {
  return new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 })
}

/** Both the stack and the database have to be up; otherwise the suites skip. */
export async function probe(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('select 1')
    const res = await fetch(`${BASE_URL}/api/health`)
    return res.ok
  } catch {
    return false
  }
}

/** The panel origin has to answer as well, or the admin suite skips. */
export async function probeAdmin(): Promise<boolean> {
  try {
    const res = await fetch(`${ADMIN_BASE_URL}/api/health`)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Cascades through towns, sessions, notes and scores via the FKs.
 *
 * `admin_users` is a separate table with its own cascade, so it needs its own
 * statement -- and the seeded `admin@izariam.local` can never match the prefix,
 * so a test run cannot delete the only way into the panel.
 */
export async function cleanup(pool: pg.Pool) {
  await pool.query(`delete from users where login like $1`, [`${E2E_PREFIX}%`])
  await pool.query(`delete from admin_users where email like $1`, [`${E2E_PREFIX}%`])
}
