/**
 * The 65 page keys, and the two dispatch tables that hang off them.
 *
 * Ports izariam/models/view_model.php: `show_view` (:201-269) decides what the
 * main pane renders, `show_bread` (:18-88) which of the 15 breadcrumb templates
 * runs, and `show_sidebox` (:91-161) which left-hand boxes appear. All three
 * are one giant switch each, so all three become one table each.
 *
 * Two `break`s are missing in the legacy and both are reproduced, because the
 * screens are laid out around the result:
 *
 * - :127, the `sidebox/update` case list falls through into the list below it,
 *   so 19 building screens render the upgrade panel *and then* their own
 *   sidebox. Four of those own sideboxes (wall, tavern, palace, palaceColony)
 *   are 0-byte files, which is only survivable because of this fall-through.
 * - :152, `militaryAdvisorCombatReportsArchive` falls into `militaryOverview`.
 *
 * `bread/researchDetail.php` exists but is unreachable: :50 routes
 * researchDetail to the `null` template instead. Not ported.
 */

import { BUILDING_CLASS } from '@izariam/gamedata'

/** Every value `show_view` accepts. Anything else renders `view/null`. */
export const PAGES = [
  'worldmap_iso',
  'colonize',
  'abolishColony',
  'academy',
  'alchemist',
  'armyGarrisonEdit',
  'barracks',
  'branchOffice',
  'buildingDetail',
  'buildingGround',
  'carpentering',
  'city',
  'cityMilitary',
  'credits',
  'demolition',
  'diplomacyAdvisor',
  'diplomacyAdvisorOutBox',
  'error',
  'finances',
  'fleetGarrisonEdit',
  'forester',
  'glassblowing',
  'highscore',
  'informations',
  'island',
  'merchantNavy',
  'militaryAdvisorCombatReports',
  'militaryAdvisorCombatReportsArchive',
  'militaryAdvisorMilitaryMovements',
  'options',
  'options_deletion_confirm',
  'palace',
  'palaceColony',
  'pedia',
  'plunder',
  'port',
  'premium',
  'premiumDetails',
  'premiumPayment',
  'premiumTradeAdvisor',
  'renameCity',
  'researchAdvisor',
  'researchDetail',
  'researchOverview',
  'resource',
  'safehouse',
  'safehouseMissions',
  'safehouseReports',
  'sendIKMessage',
  'sendSpy',
  'shipyard',
  'stonemason',
  'takeOffer',
  'tavern',
  /* Not a legacy page: the 2012 game builds a temple and has nowhere to click
     it -- `view_model.php` has no `temple` case, so the city view sends you to
     the empty-ground screen instead. */
  'temple',
  'townHall',
  'tradeAdvisor',
  'tradeAdvisorTradeRoute',
  'tradegood',
  'transport',
  'wall',
  'warehouse',
  'winegrower',
  'version',
  'wonder',
  'wonderDetail',
] as const

export type Page = (typeof PAGES)[number]

const PAGE_SET = new Set<string>(PAGES)

export function isPage(value: string): value is Page {
  return PAGE_SET.has(value)
}

/**
 * `view/admin.php` is a 0-byte file and there is no controller behind it, so
 * the key is dropped rather than ported. Same for the three dead links the
 * legacy still renders (game/islandBoard, game/reportPlayer,
 * game/options_umod_confirm) -- they were already 404s in 2012.
 *
 * `game/wonder` was a fourth until the monument was built: the legacy links to
 * it from the island board and has no controller behind it, and this port now
 * does have the screen. See screens/Wonder.tsx.
 */
export const DROPPED = ['admin'] as const

/** Building type -> page key, from Data_Model::building_class_by_type(). */
export function pageForBuildingType(type: number): Page | undefined {
  const name = BUILDING_CLASS[String(type)]
  return name && isPage(name) ? name : undefined
}

/** Page key -> building type. The inverse of the map above. */
export const BUILDING_TYPE_BY_PAGE: Record<string, number> = Object.fromEntries(
  Object.entries(BUILDING_CLASS).map(([type, name]) => [name, Number(type)]),
)

// ---------------------------------------------------------------------------
// Hash routing
// ---------------------------------------------------------------------------

/**
 * `#/{page}/{p1}/{p2}/{p3}`, mirroring the legacy's
 * `game/{location}/{param1}/{param2}/{param3}`. A router library would add a
 * second source of truth for a URL scheme that is already this flat.
 */
export interface Route {
  page: Page
  params: [number, number, number]
  /** The raw first segment, for the handful of screens that want a string. */
  raw: string[]
}

const DEFAULT_ROUTE: Route = { page: 'city', params: [0, 0, 0], raw: [] }

export function parseHash(hash = window.location.hash): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [page, ...rest] = parts
  if (!page || !isPage(page)) return DEFAULT_ROUTE
  const params: [number, number, number] = [
    Number(rest[0] ?? 0) || 0,
    Number(rest[1] ?? 0) || 0,
    Number(rest[2] ?? 0) || 0,
  ]
  return { page, params, raw: rest }
}

export function hashFor(page: Page, ...params: (number | string)[]): string {
  return `#/${[page, ...params].join('/')}`
}

// ---------------------------------------------------------------------------
// Breadcrumbs (show_bread, view_model.php:18-88)
// ---------------------------------------------------------------------------

/** The 15 templates in izariam/views/bread/. */
export type BreadTemplate =
  | '_island'
  | 'building'
  | 'city'
  | 'informations'
  | 'island'
  | 'null'
  | 'pedia'
  | 'plunder'
  | 'resource'
  | 'town'
  | 'tradeAdvisor'
  | 'tradegood'
  | 'world'
  | 'worldmap_iso'

export interface BreadSpec {
  template: BreadTemplate
  /** Language key for the leaf caption. Absent means "the building's name". */
  captionKey?: string
  /** Building type the `building` template links to on its fourth crumb. */
  type?: number
}

/**
 * The explicit cases from show_bread. Anything not listed either uses the
 * `town` template (the 19 building screens) or falls through to `default`,
 * where the template name equals the page key.
 */
const BREAD: Partial<Record<Page, BreadSpec>> = {
  abolishColony: { template: 'building', captionKey: 'leave_colony', type: 1 },
  buildingDetail: { template: 'world', captionKey: 'building_info' },
  cityMilitary: { template: 'town', captionKey: 'military_advisor_title' },
  colonize: { template: '_island', captionKey: 'colonize' },
  credits: { template: 'world', captionKey: 'credits' },
  demolition: { template: 'building', captionKey: 'confirm' },
  diplomacyAdvisor: { template: 'world', captionKey: 'diplomatic_advisor' },
  diplomacyAdvisorOutBox: { template: 'world', captionKey: 'diplomatic_advisor' },
  error: { template: 'null', captionKey: 'error' },
  finances: { template: 'null', captionKey: 'finances' },
  highscore: { template: 'null', captionKey: 'top_list' },
  merchantNavy: { template: 'null', captionKey: 'merchant_navy' },
  militaryAdvisorCombatReports: { template: 'world', captionKey: 'military_advisor' },
  militaryAdvisorCombatReportsArchive: { template: 'world', captionKey: 'military_advisor' },
  militaryAdvisorMilitaryMovements: { template: 'world', captionKey: 'military_advisor' },
  options: { template: 'null', captionKey: 'options' },
  options_deletion_confirm: { template: 'null', captionKey: 'settings' },
  premium: { template: 'null', captionKey: 'izariam_plus' },
  premiumDetails: { template: 'null', captionKey: 'izariam_plus' },
  premiumPayment: { template: 'null', captionKey: 'izariam_plus' },
  premiumTradeAdvisor: { template: 'tradeAdvisor', captionKey: 'constructions_review' },
  renameCity: { template: 'building', captionKey: 'rename_city', type: 1 },
  researchAdvisor: { template: 'world', captionKey: 'research_advisor' },
  // :50 sends this to the `null` template, so bread/researchDetail.php is dead.
  researchDetail: { template: 'null', captionKey: 'research_detail' },
  researchOverview: { template: 'building', captionKey: 'library', type: 3 },
  safehouseMissions: { template: 'building', captionKey: 'missions', type: 14 },
  safehouseReports: { template: 'building', captionKey: 'esp_report', type: 14 },
  sendIKMessage: { template: 'world', captionKey: 'create_message' },
  sendSpy: { template: '_island', captionKey: 'send_spy' },
  wonder: { template: '_island', captionKey: 'wonder' },
  tradeAdvisor: { template: 'world', captionKey: 'mayor' },
  tradeAdvisorTradeRoute: { template: 'world', captionKey: 'mayor' },
  transport: { template: '_island', captionKey: 'transport' },
  version: { template: 'world', captionKey: 'changelog' },
  wonderDetail: { template: 'world', captionKey: 'wonder_info' },
}

/** The 19 that share the `town` template and caption themselves. */
const TOWN_BREAD: Page[] = [
  'academy',
  'alchemist',
  'barracks',
  'branchOffice',
  'buildingGround',
  'carpentering',
  'forester',
  'glassblowing',
  'palace',
  'palaceColony',
  'port',
  'tavern',
  'townHall',
  'safehouse',
  'shipyard',
  'stonemason',
  'temple',
  'wall',
  'warehouse',
  'winegrower',
]

/** Garrison edits borrow the barracks' and shipyard's crumbs (:19-20). */
const BREAD_ALIAS: Partial<Record<Page, Page>> = {
  armyGarrisonEdit: 'barracks',
  fleetGarrisonEdit: 'shipyard',
}

export function breadFor(page: Page, params: [number, number, number]): BreadSpec {
  const key = BREAD_ALIAS[page] ?? page

  // takeOffer captions itself off param2 rather than off a fixed key (:57).
  if (key === 'takeOffer') {
    return {
      template: 'building',
      captionKey: params[1] === 0 ? 'accept_rate' : 'accept_offer',
      type: 12,
    }
  }

  const explicit = BREAD[key]
  if (explicit) return explicit
  if (TOWN_BREAD.includes(key)) {
    return { template: 'town', type: BUILDING_TYPE_BY_PAGE[key] ?? 0 }
  }
  // default: the template name is the page name. Only city, island, pedia,
  // informations, plunder, resource, tradegood and worldmap_iso reach here.
  return { template: key as BreadTemplate }
}

// ---------------------------------------------------------------------------
// Sideboxes (show_sidebox, view_model.php:91-161)
// ---------------------------------------------------------------------------

/**
 * The 19 building screens. They hit the `sidebox/update` case, which has no
 * `break`, so they render the upgrade panel and then fall into the list below
 * and render their own box too.
 */
const UPGRADE_SIDEBOX: Page[] = [
  'academy',
  'alchemist',
  'barracks',
  'branchOffice',
  'carpentering',
  'forester',
  'glassblowing',
  'palace',
  'palaceColony',
  'port',
  'safehouse',
  'shipyard',
  'stonemason',
  'tavern',
  'temple',
  'townHall',
  'wall',
  'warehouse',
  'winegrower',
]

/**
 * Pages whose own sidebox is `sidebox/{page}.php`. The 19 above reach this
 * list too, via the missing `break` -- which is exactly why wall, tavern,
 * palace and palaceColony ship 0-byte sidebox files: without the fall-through
 * they would render nothing at all, upgrade panel included.
 */
const OWN_SIDEBOX: Page[] = [
  'armyGarrisonEdit',
  'city',
  'diplomacyAdvisor',
  'fleetGarrisonEdit',
  'island',
  'merchantNavy',
  'premium',
  'premiumDetails',
  'premiumPayment',
  'premiumTradeAdvisor',
  'renameCity',
  'researchAdvisor',
  'researchOverview',
  'resource',
  'safehouseMissions',
  'safehouseReports',
  'takeOffer',
  'tradeAdvisor',
  'highscore',
  'tradegood',
]

/** `sidebox/backToCity.php`. */
const BACK_TO_CITY: Page[] = ['abolishColony', 'credits', 'error', 'finances', 'version']

/** `sidebox/back_to_island.php`. */
const BACK_TO_ISLAND: Page[] = ['colonize', 'plunder', 'sendSpy', 'transport', 'wonder']

/** Boxes that take the first URL parameter. */
const PARAMETERISED: Page[] = [
  'demolition',
  'cityMilitary',
  'informations',
  'researchDetail',
  'wonderDetail',
  'buildingDetail',
  'pedia',
]

/**
 * These four `sidebox/*.php` files are 0 bytes; they render nothing.
 * `sidebox/finances.php` is a fifth dead file -- it has content, but :103
 * routes `finances` to backToCity, so nothing ever loads it.
 */
export const EMPTY_SIDEBOXES = new Set(['wall', 'tavern', 'palace', 'palaceColony'])

/**
 * Which sidebox files a page renders, in order. More than one is normal --
 * see the missing `break` at :127.
 */
export function sideboxesFor(page: Page): string[] {
  // :92, the outbox borrows the inbox's sidebox.
  const key: Page = page === 'diplomacyAdvisorOutBox' ? 'diplomacyAdvisor' : page

  if (key === 'options') return ['inviteFriends']
  if (key === 'worldmap_iso') return ['worldmap_iso']
  if (PARAMETERISED.includes(key)) return [key]
  if (BACK_TO_CITY.includes(key)) return ['backToCity']
  if (BACK_TO_ISLAND.includes(key)) return ['back_to_island']

  if (key === 'militaryAdvisorCombatReportsArchive') {
    // Falls through to militaryOverview (:152, no break).
    return ['militaryAdvisorCombatReportsArchive', 'militaryOverview']
  }
  if (key === 'militaryAdvisorCombatReports' || key === 'militaryAdvisorMilitaryMovements') {
    return ['militaryOverview']
  }

  const boxes: string[] = []
  if (UPGRADE_SIDEBOX.includes(key)) boxes.push('update')
  if (UPGRADE_SIDEBOX.includes(key) || OWN_SIDEBOX.includes(key)) boxes.push(key)
  return boxes.filter((box) => !EMPTY_SIDEBOXES.has(box))
}


