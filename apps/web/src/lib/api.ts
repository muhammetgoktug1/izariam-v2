/**
 * Client for the JSON API.
 *
 * The legacy had no API: 68 of its 70 read screens rendered server-side from
 * the same Player_Model graph, and only two endpoints ever emitted JSON. That
 * graph is now one GET, so the client holds the whole player state and every
 * screen reads from it.
 */

import type { DerivedPlayer, PlayerState } from '@izariam/rules'
import type { MapIsland } from '@izariam/shared'

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

function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)izariam_csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]!) : null
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('content-type', 'application/json')
  const token = csrfToken()
  if (token && init.method && init.method !== 'GET') headers.set('x-csrf-token', token)

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'unknown' }))) as ApiFailure

    /**
     * A live session whose CSRF cookie went missing. That used to be a dead
     * end -- the session cookie lasts a week and the CSRF one had no expiry at
     * all, so closing the browser left an account that could read every screen
     * and change nothing, with `csrf_failed` printed in place of each action's
     * result. The cookie now carries the session's own lifetime; this fetches
     * a fresh token for whatever else can lose it.
     */
    if (res.status === 403 && body.error === 'csrf_failed' && retry) {
      await fetch('/api/auth/csrf', { credentials: 'same-origin' })
      return request<T>(path, init, false)
    }

    throw new ApiError(res.status, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * The graph, typed from the rules package rather than restated here.
 *
 * The first cut of this file hand-maintained a parallel set of interfaces --
 * TownView, IslandView, DerivedTownView -- which had already drifted: they were
 * missing branchOffice, spies, the two unit queues and the whole mission shape.
 * The rules package is pure TypeScript over JSON tables, so the browser can
 * import it directly and every screen prices things with the same function the
 * server validates with.
 */
export interface ChromeResponse {
  newTownMessages: number
  newUserMessages: number
  newSpyMessages: number
  notes: string
  researchAdvisor: boolean
  missionsLoading: number
  transports: { free: number; total: number }
  hasPremium: boolean
  /** Keyed by town id. */
  towns: Record<string, { buildEndsAt: number | null; maxActionPoints: number }>
  /**
   * Faith on each island the player has a town on, keyed by island id.
   *
   * Server-side because it sums the priests and the population of *every* town
   * there, including other players' -- the graph the client holds has no way to
   * reach them.
   */
  faith: Record<string, { islandId: number; priests: number; capacity: number; faith: number }>
}

export interface StateResponse {
  /** Server time when this snapshot was produced, epoch seconds. */
  now: number
  state: PlayerState
  derived: DerivedPlayer
  chrome: ChromeResponse
}

export interface IslandSlotView {
  slot: number
  town: {
    id: number
    name: string
    userId: number
    owner: string
    level: number
    score: number
    hasBranchOffice: boolean
    /** The camp rosters print each town's own figures (resource.php:106). */
    workers: number
    tradegood: number
    workersWood: number
    tradegoodWood: number
  } | null
}

export interface IslandDetail {
  island: {
    id: number
    name: string
    x: number
    y: number
    type: number
    tradeResource: number
    wonder: number
    woodLevel: number
    tradeLevel: number
    woodDonated: number
    tradeDonated: number
    wonderLevel: number
    townCount: number
  }
  slots: IslandSlotView[]
}

/**
 * The monument's screen, one request of its own.
 *
 * `/api/state` carries island faith as one number per island; this is the
 * breakdown behind it -- a row per town on the island, whoever owns it -- and
 * only the wonder screen wants it.
 */
export interface WonderTownRow {
  townId: number
  slot: number
  userId: number
  owner: string
  name: string
  donated: number
  priests: number
  /** Islanders these priests have converted, five each. */
  converted: number
  capacity: number
  /** This town's slice of the island's converted islanders, 0..1. */
  share: number
}

export interface WonderView {
  island: {
    id: number
    name: string
    wonder: number
    wonderLevel: number
    tradeResource: number
    donated: Record<'wine' | 'marble' | 'crystal' | 'sulfur', number>
    /** The three luxuries this island accepts: everything it does not dig up. */
    goods: ('wine' | 'marble' | 'crystal' | 'sulfur')[]
    /** What each of the three costs for the next expansion; null at level 5. */
    costPerGood: number | null
  }
  faith: { islandId: number; priests: number; capacity: number; faith: number }
  towns: WonderTownRow[]
}

export interface MailMessage {
  id: number
  from: number
  to: number
  type: number
  date: number
  text: string
  checkedTo: number
  /** Display-only companions the diplomacy advisor's table prints. */
  fromLogin: string
  toLogin: string
  fromTown: {
    id: number
    name: string | null
    islandId: number | null
    x: number | null
    y: number | null
  } | null
}

/**
 * One line of the town advisor's news list.
 *
 * The legacy stored a rendered HTML sentence per row; this keeps the event and
 * its numbers apart so the client can render it in the chosen language.
 */
export interface TownMessage {
  id: number
  townId: number | null
  /** `building_completed`, `mission_fleet_returned`, … */
  kind: string
  params: Record<string, unknown>
  /** Epoch seconds. */
  createdAt: number
  read: boolean
}

export interface HighscoreRow {
  rank: number
  userId: number
  login: string
  value: number
  towns: number
}

/** What the safehouse screens need about a town a spy is sitting in. */
export interface SpyTargetView {
  id: number
  userId: number
  name: string
  islandId: number
  x: number
  y: number
  spies: number
  townHallLevel: number
  safehouseLevel: number
}

export interface BranchOfficeView {
  town: {
    id: number
    name: string
    userId: number
    owner: string
    x: number
    y: number
    island: string
    hasBranchOffice: boolean
  }
  offers: { resource: string; direction: number; count: number; price: number }[]
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  register: (body: { login: string; password: string; email: string }) =>
    request<{ userId: number; townId: number }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { login: string; password: string }) =>
    request<{ userId: number }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  /** The token comes back only outside production, where no mail is sent. */
  forgotPassword: (body: { email: string }) =>
    request<{ ok: true; token?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetPassword: (body: { token: string; password: string }) =>
    request<{ ok: true }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  state: () => request<StateResponse>('/state'),
  map: (area: { xMin: number; xMax: number; yMin: number; yMax: number }) =>
    request<{ islands: MapIsland[] }>(
      `/map?xMin=${area.xMin}&xMax=${area.xMax}&yMin=${area.yMin}&yMax=${area.yMax}`,
    ),

  island: (id: number) => request<IslandDetail>(`/island/${id}`),
  islandWonder: (id: number) => request<WonderView>(`/island/${id}/wonder`),
  messages: (box: 'inbox' | 'outbox') =>
    request<{ messages: MailMessage[] }>(`/messages/${box}`),
  highscore: (category: string, page = 0) =>
    request<{
      category: string
      page: number
      perPage: number
      total: number
      rows: HighscoreRow[]
    }>(`/highscore?category=${encodeURIComponent(category)}&page=${page}`),
  branchOffice: (townId: number) => request<BranchOfficeView>(`/town/${townId}/branch-office`),
  townMessages: () => request<{ messages: TownMessage[] }>('/town-messages'),
  /** What opening the town advisor did in the legacy, as its own request. */
  readTownMessages: () =>
    request<{ ok: true; marked: number }>('/town-messages/read', { method: 'POST' }),
  notes: () => request<{ text: string }>('/notes'),
  spyTargets: () =>
    request<{ targets: Record<string, SpyTargetView> }>('/spy-targets'),
  saveNotes: (text: string) =>
    request<{ ok: true }>('/notes', { method: 'PUT', body: JSON.stringify({ text }) }),

  /**
   * Every mutation. The server answers `{ok:true}` and the caller refetches
   * /api/state rather than patching a local copy: the tick runs on every
   * request, so any local guess about what changed is wrong the moment an
   * accrual or an arriving fleet lands in the same call.
   */
  action: <T = { ok: true }>(path: string, body: unknown = {}) =>
    request<T>(`/actions/${path}`, { method: 'POST', body: JSON.stringify(body) }),
}
