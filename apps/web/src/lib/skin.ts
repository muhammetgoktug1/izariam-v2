/**
 * Stylesheet loading for the legacy skin.
 *
 * The cascade order is load-bearing: two skin generations define overlapping
 * selectors and the later file is expected to win. game_index.php:39-61 loads
 *
 *   skin/ik_common_0.4.5.css        (ik_common_0.0.1.css is commented out)
 *   skin/ik_{page}_0.0.1.css        (skipped when page === 'island')
 *   skin/ik_{page}_0.4.5.css
 *   css/new.css
 *
 * and this reproduces it exactly. Sheets are appended to <head> in that order
 * and page-specific ones are swapped on navigation; the shared ones stay.
 *
 * Nothing here rewrites the CSS -- all 8,413 rules are used verbatim, which is
 * only viable because the skin contains zero child combinators, so React is
 * free to nest extra wrappers as long as the ids and classes match.
 */

const SKIN_VERSION = '0.0.1'
const NEW_VERSION = '0.4.5'
const MARKER = 'data-izariam-skin'

/** Pages whose 0.0.1 stylesheet the legacy deliberately skips. */
const NO_LEGACY_SHEET = new Set(['island'])

function href(path: string): string {
  return `/${path}`
}

function sheetsFor(page: string): string[] {
  const sheets = [`skin/ik_common_${NEW_VERSION}.css`]
  if (!NO_LEGACY_SHEET.has(page)) sheets.push(`skin/ik_${page}_${SKIN_VERSION}.css`)
  sheets.push(`skin/ik_${page}_${NEW_VERSION}.css`)
  sheets.push('css/new.css')
  return sheets
}

/**
 * Point <head> at the sheets this page needs, in order.
 *
 * Existing links are reused rather than recreated so navigating between
 * screens does not flash unstyled content. A missing per-page sheet 404s
 * silently, exactly as it did in the legacy -- several pages have no skin file
 * of their own.
 */
export function applySkin(page: string) {
  applySheets(sheetsFor(page))
}

function applySheets(wanted: string[]) {
  const head = document.head
  const existing = Array.from(head.querySelectorAll<HTMLLinkElement>(`link[${MARKER}]`))

  const keep = new Set<string>()
  let previous: Element | null = null

  for (const path of wanted) {
    const url = href(path)
    keep.add(url)
    let link = existing.find((l) => l.getAttribute('href') === url)
    if (!link) {
      link = document.createElement('link')
      link.rel = 'stylesheet'
      link.type = 'text/css'
      link.setAttribute(MARKER, '')
      link.href = url
    }
    // Re-insert in order; insertBefore on an attached node moves it.
    if (previous) previous.after(link)
    else head.prepend(link)
    previous = link
  }

  for (const link of existing) {
    if (!keep.has(link.getAttribute('href') ?? '')) link.remove()
  }
}

/**
 * The logged-out start page. main_index_4.php:25-28 links these instead of
 * the game skin; css/style.css is an @import shell pulling in gf_reset,
 * gf_default and layout.css (1,133 lines), which is the actual start page.
 */
const START_PAGE_SHEETS = ['css/style.css', 'css/defaultStartpageTemplate.css']

export function applyStartPageSkin() {
  applySheets(START_PAGE_SHEETS)
}

/**
 * Drop every skin sheet. Used when leaving the game for the start page, which
 * has a completely disjoint stylesheet set -- leaving the in-game cascade in
 * place would give the login form body#city and the whole game chrome.
 */
export function clearSkin() {
  for (const link of Array.from(document.head.querySelectorAll(`link[${MARKER}]`))) {
    link.remove()
  }
}

/**
 * The skin keys most page-level rules off the body id, e.g.
 * `#city #container #mainview #locations #position7 { left:323px; top:283px }`
 * (design/skin/ik_city_0.4.5.css:33-58). game_index.php:295 sets it from the
 * page name, so the router has to as well.
 */
export function applyBodyId(page: string) {
  document.body.id = page
}
