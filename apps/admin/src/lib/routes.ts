/**
 * Hash routing, by hand.
 *
 * `react-router` is in the root tree but imported nowhere, and the game routes
 * its 65 pages by hash through a table of its own (apps/web/src/lib/routes.ts).
 * Five screens still do not need a data router; a hash gives working deep links
 * and back/forward, and needs no history fallback in the dev server.
 */

/** Every screen behind the login gate. Adding one here is a compile error in
 *  App.tsx until the dispatch table has an entry for it -- which is the whole
 *  reason the list exists rather than a union written out by hand. */
export const PAGES = ['summary', 'players', 'resources', 'admins', 'audit'] as const

export type Page = (typeof PAGES)[number]

/** Where an empty or unrecognised hash lands. */
export const HOME: Page = 'summary'

export interface Route {
  page: Page
  /**
   * Everything after `?`, unparsed.
   *
   * Each screen owns its own keys -- `q` on the player list, `player` on the
   * resource grant, `action`/`admin`/`target`/`from`/`to` on the audit log --
   * so naming them here would mean this module changing every time a screen
   * grows a filter.
   *
   * **Never put this object in a React Query key.** `parseHash` builds a fresh
   * `URLSearchParams` on every render and `JSON.stringify(new
   * URLSearchParams('a=1'))` is `"{}"`, so two different filter sets would hash
   * identically: the screen would not refetch and would silently show the
   * previous result. App.tsx pulls primitives out and hands each screen plain
   * strings.
   */
  params: URLSearchParams
}

function isPage(value: string): value is Page {
  return (PAGES as readonly string[]).includes(value)
}

export function parseHash(hash: string = window.location.hash): Route {
  const [path, search] = hash.replace(/^#\/?/, '').split('?')
  return {
    page: path && isPage(path) ? path : HOME,
    params: new URLSearchParams(search ?? ''),
  }
}

/**
 * `#/players?q=ali`.
 *
 * The params are an object rather than a positional value: there are now three
 * screens with different filters, and a second positional argument would mean a
 * different thing on each. Empty and undefined values are dropped, so
 * `hashFor('players', { q: '' })` is a clean `#/players`.
 */
export function hashFor(
  page: Page,
  params: Record<string, string | number | undefined> = {},
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `#/${page}?${query}` : `#/${page}`
}

/** Navigating is assigning the hash; this exists so screens do not each spell
 *  out `window.location.hash = hashFor(...)`. */
export function navigate(
  page: Page,
  params?: Record<string, string | number | undefined>,
): void {
  window.location.hash = hashFor(page, params)
}

export function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function currentHash(): string {
  return window.location.hash
}
