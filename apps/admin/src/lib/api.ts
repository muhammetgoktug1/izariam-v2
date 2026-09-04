/**
 * Client for the panel API.
 *
 * The same shape as the game's client (apps/web/src/lib/api.ts) rather than a
 * shared module, on purpose: the two differ in the cookie they read and the
 * prefix they call, and importing the game's would drag @izariam/rules and the
 * whole gamedata catalogue into this bundle. Hoisting it into @izariam/shared
 * is not possible either -- that package's tsconfig has no DOM lib, because the
 * API compiles against it too.
 */

import type { GrantResource } from '@izariam/shared/admin'
import type {
  AdminAuditListRequest,
  AdminBanRequest,
  AdminLoginRequest,
  AdminPlayerCreateRequest,
  AdminPlayerListRequest,
  AdminPlayerUpdateRequest,
  AdminResourceGrantRequest,
  AdminUserCreateRequest,
  AdminUserUpdateRequest,
} from '@izariam/shared/admin'

export interface ApiFailure {
  error: string
  detail?: unknown
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiFailure,
  ) {
    super(body.error)
  }
}

/** The panel's own CSRF cookie. It is readable by design; the session cookie
 *  beside it is httpOnly and scoped to /api/admin. */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)izariam_admin_csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]!) : null
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('content-type', 'application/json')
  const token = csrfToken()
  if (token && init.method && init.method !== 'GET') headers.set('x-csrf-token', token)

  const res = await fetch(`/api/admin${path}`, { ...init, headers, credentials: 'same-origin' })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'unknown' }))) as ApiFailure

    // A session that outlived its CSRF cookie can heal itself once, exactly as
    // the game client does.
    if (res.status === 403 && body.error === 'csrf_failed' && retry) {
      await fetch('/api/admin/auth/csrf', { credentials: 'same-origin' })
      return request<T>(path, init, false)
    }

    throw new ApiError(res.status, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export interface Admin {
  id: number
  email: string
  name: string
  role: string
}

export interface AdminRow extends Admin {
  active: boolean
  createdAt: number
  lastLoginAt: number | null
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

export interface PlayerTown {
  id: number
  name: string
  islandId: number
  slot: number
  x: number
  y: number
}

export interface TownStock {
  id: number
  name: string
  islandId: number
  x: number
  y: number
  slot: number
  active: boolean
  /** null for a town that is still being founded -- it has no warehouse yet. */
  capacity: number | null
  resources: Record<GrantResource, number>
  /** Seconds the town's clock sits behind now; > 0 after a fleet lands. */
  rewoundBy: number
}

export interface AccountStock {
  gold: number
  ambrosia: number
  researchPoints: number
  transports: { free: number; total: number }
}

/** One fleet in flight, for the support desk: where, doing what, next event. */
export interface MissionRow {
  id: number
  kind: 'colonise' | 'transport' | 'buy' | 'sell' | 'attack' | 'plunder'
  fromName: string | null
  toName: string | null
  phase: 'loading' | 'outbound' | 'returning'
  /** Projected departure while loading, else the next port call. */
  arrivesAt: number | null
  transports: number
}

export interface PlayerResources {
  now: number
  player: { id: number; login: string; lastVisitAt: number | null }
  towns: TownStock[]
  account: AccountStock
  missions: MissionRow[]
}

export interface TownGrant {
  id: number
  name: string
  capacity: number
  before: Record<GrantResource, number>
  after: Record<GrantResource, number>
  clamped: GrantResource[]
  floored: GrantResource[]
  rewoundBy: number
}

export interface GrantResult {
  now: number
  towns: TownGrant[]
  account: { before: AccountStock; after: AccountStock; floored: string[] }
  clampedTowns: number
  clampedFields: number
}

export interface AuditRow {
  id: number
  createdAt: number
  action: string
  targetType: string
  targetId: number | null
  targetLabel: string | null
  meta: Record<string, unknown> | null
  ip: string | null
  admin: { id: number; email: string; name: string } | null
}

export interface AuditPage {
  rows: AuditRow[]
  total: number
  page: number
  perPage: number
}

export interface Summary {
  counts: {
    players: number
    banned: number
    newWeek: number
    newDay: number
    online: number
    towns: number
    admins: number
    adminsActive: number
    openSessions: number
    actionsDay: number
  }
  recent: AuditRow[]
  top: { id: number; login: string; value: number }[]
}

export interface PlayerPage {
  rows: PlayerRow[]
  total: number
  page: number
  perPage: number
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const api = {
  me: () => request<{ admin: Admin }>('/auth/me'),
  login: (body: AdminLoginRequest) => post<{ admin: Admin }>('/auth/login', body),
  logout: () => post<void>('/auth/logout'),

  admins: () => request<{ rows: AdminRow[] }>('/admins'),
  createAdmin: (body: AdminUserCreateRequest) => post<{ id: number }>('/admins', body),
  updateAdmin: (id: number, body: AdminUserUpdateRequest) =>
    request<{ ok: true }>(`/admins/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAdmin: (id: number) => request<void>(`/admins/${id}`, { method: 'DELETE' }),

  players: (params: Partial<AdminPlayerListRequest>) =>
    request<PlayerPage>(`/players${query(params)}`),
  player: (id: number) => request<{ player: PlayerRow; towns: PlayerTown[] }>(`/players/${id}`),
  createPlayer: (body: AdminPlayerCreateRequest) =>
    post<{ userId: number; townId: number }>('/players', body),
  updatePlayer: (id: number, body: AdminPlayerUpdateRequest) =>
    request<{ ok: true }>(`/players/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  ban: (id: number, body: AdminBanRequest) =>
    post<{ blockedUntil: number; permanent: boolean; sessionsRevoked: number }>(
      `/players/${id}/ban`,
      body,
    ),
  unban: (id: number) => post<{ ok: true }>(`/players/${id}/unban`),
  resetLink: (id: number) => post<{ token: string }>(`/players/${id}/reset-link`),
  playerResources: (id: number) => request<PlayerResources>(`/players/${id}/resources`),
  grantResources: (id: number, body: AdminResourceGrantRequest) =>
    post<GrantResult>(`/players/${id}/resources`, body),

  audit: (params: Partial<AdminAuditListRequest>) => request<AuditPage>(`/audit${query(params)}`),
  summary: () => request<Summary>('/summary'),
  // Deliberately no deletePlayer: accounts are banned, never deleted. A `users`
  // row cascades through towns, army, missions, messages and scores.
}
