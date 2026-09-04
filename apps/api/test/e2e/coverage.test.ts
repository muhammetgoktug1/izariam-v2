/**
 * Static guards over the seams where a mistake is silent rather than loud.
 *
 * None of these needs a running stack. An endpoint nothing calls looks finished
 * from the server side and is simply missing from the game; a translation key
 * nothing defines renders as the empty string rather than as an error
 * (apps/web/src/lib/i18n.ts:14-19); and a class name the skin positions off,
 * left out of the markup, moves the element somewhere else on the page without
 * anything failing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const WEB_SRC = join(ROOT, 'apps/web/src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

const webSources = walk(WEB_SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }))

describe('every action endpoint is reachable from the client', () => {
  /**
   * Endpoints the client deliberately never calls.
   *
   * `abortBuildings` has no caller in the *legacy* either -- a grep over
   * izariam/ finds only the controller method (actions.php:60). Its two
   * sideboxes cancel a build by navigating to the demolition screen
   * (views/sidebox/city.php:45) or by dropping a queued entry with
   * `leaveConstructionList` (:96). Porting a button the original never had
   * would be inventing a feature, so the endpoint stays and nothing calls it.
   */
  const INTENTIONALLY_UNCALLED = new Set(['abortBuildings'])

  const routes = [
    ...readFileSync(join(ROOT, 'apps/api/src/routes/actions.ts'), 'utf8').matchAll(
      /Router\.post\(\s*'\/actions\/([^']+)'/g,
    ),
  ].map((m) => m[1]!)

  /**
   * The endpoint name has to appear as a literal somewhere in the client.
   *
   * Matching `ctx.act('x')` alone is too narrow: three call sites pass the name
   * through a variable or a ternary -- the barracks and shipyard share one
   * component and take theirs as a prop (Recruit.tsx:81,88), and the trade
   * route form picks between create and edit at submit time. Any literal
   * occurrence counts, which is loose but catches the failure that matters: an
   * endpoint whose name appears nowhere in the client cannot be reached.
   */
  const clientText = webSources.map((s) => s.text).join('\n')
  const called = new Set(routes.filter((route) => clientText.includes(`'${route}'`)))

  it('finds at least the 40 endpoints the API mounts', () => {
    expect(routes.length).toBeGreaterThanOrEqual(40)
  })

  it.each(routes)('/actions/%s has a caller', (route) => {
    if (INTENTIONALLY_UNCALLED.has(route)) return
    expect(called, `no screen calls /actions/${route}`).toContain(route)
  })

  it('does not list an endpoint as uncalled once it has a caller', () => {
    for (const route of INTENTIONALLY_UNCALLED) {
      expect(called, `${route} is called now; drop it from the exception list`).not.toContain(route)
    }
  })
})

const i18nSource = readFileSync(join(WEB_SRC, 'lib/i18n.ts'), 'utf8')

function hardcodedKeys(name: string): Set<string> {
  const start = i18nSource.indexOf(`const ${name}: Record<string, string> = {`)
  if (start < 0) throw new Error(`${name} not found in i18n.ts`)
  const end = i18nSource.indexOf('\n}\n', start)
  return new Set(
    [...i18nSource.slice(start, end).matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]!),
  )
}

const catalog = (file: string) =>
  Object.keys(JSON.parse(readFileSync(join(ROOT, `packages/gamedata/i18n/${file}`), 'utf8')) as object)

/**
 * What `t()` can resolve for a Turkish player: `TR ?? HARDCODED_TR ?? EN ??
 * HARDCODED` (i18n.ts). A key outside all four renders as the empty string.
 */
const KNOWN_KEYS = new Set([
  ...catalog('tr.json'),
  ...catalog('en.json'),
  ...hardcodedKeys('HARDCODED'),
  ...hardcodedKeys('HARDCODED_TR'),
])

const TURKISH_KEYS = new Set([...catalog('tr.json'), ...hardcodedKeys('HARDCODED_TR')])

describe('every translation key the client asks for resolves', () => {
  /** Literal `t('key')` / `tf('key')` calls, plus the error-code maps that
   *  resolve a key indirectly at render time. */
  const used = new Map<string, string>()
  for (const { path, text } of webSources) {
    for (const m of text.matchAll(/\btf?\(\s*'([^'${}]+)'/g)) used.set(m[1]!, path)
    for (const m of text.matchAll(/^\s{2}\w+:\s*'(error_[a-z0-9_]+)',/gm)) used.set(m[1]!, path)
  }

  it('collects a realistic number of keys', () => {
    expect(used.size).toBeGreaterThan(300)
  })

  it('has no key that renders as the empty string', () => {
    const missing = [...used]
      .filter(([key]) => !KNOWN_KEYS.has(key))
      .map(([key, path]) => `${key} (${path.slice(ROOT.length)})`)
    expect(missing).toEqual([])
  })

  /**
   * The families built by template literal -- `t(`building${n}_name`)` and its
   * siblings -- which the literal scan above cannot see. `wonder${n}_name` was
   * exactly this: a plausible key in no language file, so the island board's
   * wonder label rendered blank for every one of the eight.
   */
  const FAMILIES: [string, number[]][] = [
    ['building%s_name', range(1, 27)],
    ['building%s_desc', range(1, 27)],
    ['army%s_name', range(1, 23)],
    ['army%s_desc', range(1, 23)],
    ['wonder_%s', range(1, 8)],
    ['wonder%s_desc', range(1, 8)],
    ['way%s_name', range(1, 4)],
    ['spy_mission_%s_name', range(3, 10)],
    ['spy_mission_%s_desc', range(3, 10)],
    ['premium_%s', []],
  ]

  it.each(FAMILIES.filter(([, ids]) => ids.length > 0))(
    '%s resolves for its whole range',
    (pattern, ids) => {
      const missing = ids.map((n) => pattern.replace('%s', String(n))).filter((k) => !KNOWN_KEYS.has(k))
      expect(missing).toEqual([])
    },
  )

  it('resolves every island node name the three call sites can ask for', () => {
    const missing = ['wood', 'wine', 'marble', 'crystal', 'sulfur']
      .map((r) => `island_building_${r}`)
      .filter((k) => !KNOWN_KEYS.has(k))
    expect(missing).toEqual([])
  })
})

/**
 * Every refusal the player can be shown.
 *
 * `App.tsx` puts the API's error code straight into `ctx.failure` and 24
 * screens render it through `t()`. 81 of the 89 codes had no entry, so a
 * refused action printed an empty red line and the player saw nothing at all.
 * This collects the codes from the source rather than from a list, so a new
 * `reject()` in the rules engine fails here until it has wording.
 */
describe('every rejection reason has player-facing wording', () => {
  const RULES_SRC = join(ROOT, 'packages/rules/src')

  function collectReasons(): Set<string> {
    const out = new Set<string>()
    const files = [...walk(RULES_SRC), join(ROOT, 'apps/api/src/routes/actions.ts')]
    for (const path of files) {
      const text = readFileSync(path, 'utf8')
      for (const m of text.matchAll(/\b(?:reject|fail)\(\s*'([a-z0-9_]+)'/g)) out.add(m[1]!)
      for (const m of text.matchAll(/\b(?:reason|rejection):\s*'([a-z0-9_]+)'/g)) out.add(m[1]!)
      /**
       * Members of the failure unions. Scoped to types whose name says they are
       * failures -- `ActionError`, `MilitaryFailure`, `EspionageRejection` --
       * because plenty of other unions in the engine are also lowercase string
       * literals: `PremiumType` has `'account'`, `SpyOutcome` has `'spy_lost'`,
       * and neither is ever shown as a refusal.
       */
      for (const decl of text.matchAll(
        /export type \w*(?:Error|Failure|Rejection|Reason)\b[^=]*=([\s\S]*?)(?:\n\n|\nexport |\n\/\*\*)/g,
      )) {
        for (const m of decl[1]!.matchAll(/'([a-z][a-z0-9_]{3,})'/g)) out.add(m[1]!)
      }
    }
    return out
  }

  const reasons = collectReasons()

  it('finds the reason vocabulary', () => {
    expect(reasons.size).toBeGreaterThan(60)
  })

  it('has Turkish wording for each', () => {
    const missing = [...reasons].filter((r) => !TURKISH_KEYS.has(r)).sort()
    expect(missing).toEqual([])
  })
})

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/**
 * Prose that never reaches `t()`.
 *
 * The tutorial was the case that made this necessary: nine advisor scripts sat
 * in a table inside the component as plain English, so the translation layer
 * never saw them and the first thing a new player read was in the wrong
 * language. Nothing in the suite could tell, because a hardcoded string is not
 * a `t()` call to audit.
 */
describe('no user-visible text bypasses the translation layer', () => {
  /**
   * Text allowed to stay as written.
   *
   * Proper nouns first: a name is a name in every language. Then the version
   * page's changelog, which is a historical record of what changed in each
   * release rather than UI copy -- translating it would blur what it says.
   */
  const PROPER_NOUNS =
    /^(iZariam|Alpha|Polis|Ikaria|Peleus|Manuron|Lysias|Ajax|Issus|v\.|OK)\b/
  const CHANGELOG_FILES = new Set(['Reference.tsx'])

  /** `>text<` in JSX. Lines carrying an operator are skipped: `>=`, `&&` and a
   *  closing generic all look like a text node to a regex. */
  const TEXT_NODE = /(?<![=!<>-])>([^<>{}\n]+)</g
  const ATTRIBUTE = /\b(?:title|alt|placeholder|aria-label)="([^"]+)"/g
  const SUBMIT_VALUE = /<input[^>]*type="submit"[^>]*\svalue="([^"]+)"/g

  /** Two or more letters, and at least one lower-case one, so ids, sprite
   *  classes and single-letter separators do not register as prose. */
  const LOOKS_LIKE_PROSE = /[A-Za-z]{2,}/

  function offenders(): string[] {
    const out: string[] = []
    for (const { path, text } of webSources) {
      const file = path.slice(path.lastIndexOf('/') + 1)
      if (!file.endsWith('.tsx') || CHANGELOG_FILES.has(file)) continue

      text.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
        if (/=>|&&|\|\||>=|<=/.test(line)) return

        const found: string[] = []
        for (const m of line.matchAll(TEXT_NODE)) found.push(m[1]!)
        for (const m of line.matchAll(ATTRIBUTE)) found.push(m[1]!)
        for (const m of line.matchAll(SUBMIT_VALUE)) found.push(m[1]!)

        for (const raw of found) {
          const value = raw.replace(/&[a-z]+;/g, ' ').trim()
          if (!value || !LOOKS_LIKE_PROSE.test(value)) continue
          if (PROPER_NOUNS.test(value)) continue
          out.push(`${file}:${i + 1}  ${value.slice(0, 70)}`)
        }
      })
    }
    return out
  }

  it('finds no untranslated prose in the screens', () => {
    expect(offenders()).toEqual([])
  })
})

/**
 * Class names the 2012 stylesheet positions off.
 *
 * `design/` is reused byte for byte, so a screen is laid out entirely by
 * whether its markup carries the classes the skin selects on. Drop one and
 * nothing errors -- the element just stops being positioned and lands wherever
 * the flow puts it. That has happened twice: the construction sidebox wrote
 * `progressBar` where the rule says `.progressbar`, and the research advisor's
 * button wrote `button` where `#mainview .researchType a.build` does the
 * positioning, which dropped it below the description.
 *
 * This only proves the string is present in the file, not that it sits at the
 * right depth. That is enough to catch a class going missing, which is the
 * failure that actually happens.
 */
describe('screens keep the class names the skin positions off', () => {
  const CONTRACTS: { file: string; rule: string; classes: string[] }[] = [
    {
      file: 'screens/Research.tsx',
      rule: 'ik_common_0.4.5.css:808-880',
      classes: [
        'researchTypes',
        'researchType',
        'researchInfo',
        'leftBranch',
        'researchTypeLabel',
        'unitcount',
        'researchButton',
        'researchButton2',
        // The one that broke: `button` paints, `build` positions.
        'button build',
        'costs',
        'resources',
        'researchPoints',
      ],
    },
    {
      file: 'components/chrome/ConstructionList.tsx',
      rule: 'ik_common_0.0.1.css:1522-1560',
      classes: ['currentUnit', 'abortdiv', 'abort', 'amount', 'progressbar', 'constructionList'],
    },
    {
      file: 'components/chrome/UnitConstructionList.tsx',
      rule: 'ik_common_0.0.1.css:1522-1560',
      classes: ['currentUnit', 'amount', 'progressbar'],
    },
    {
      file: 'screens/City.tsx',
      rule: 'ik_city_0.0.1.css:101-117',
      classes: ['buildingGround', 'constructionSite', 'buildingimg', 'flag', 'timetofinish'],
    },
    {
      file: 'screens/Misc.tsx',
      rule: 'ik_premium_0.4.5.css:41-60',
      classes: ['TableHoriMax', 'feature', 'duration', 'cost', 'buy', 'notenough', 'buyNow'],
    },
    {
      file: 'components/Slider.tsx',
      rule: 'ik_common_0.4.5.css:3148-3172',
      // `sliderbg` is the one that broke: the skin scopes the fill and the
      // thumb *under* it, so a wrapper classed anything else silently drops
      // all three rules and the track disappears.
      classes: ['sliderbg', 'actualValue', 'sliderthumb'],
    },
    {
      file: 'screens/Recruit.tsx',
      rule: 'ik_common_0.4.5.css:2560-2602',
      classes: ['unit', 'unitinfo', 'unitcount', 'sliderinput', 'setMin', 'setMax', 'forminput', 'textfield'],
    },
    {
      file: 'screens/Academy.tsx',
      rule: 'ik_academy_0.4.5.css:20-40',
      classes: ['setScientists', 'setMin', 'setMax', 'textfield', 'overchargeMsg'],
    },
    {
      file: 'screens/Wonder.tsx',
      rule: 'ik_wonder_0.4.5.css:1-46, ik_common_0.4.5.css:1515-1533',
      // `convertion` is the skin's own spelling, and `wonder_bar` has to be on
      // the two overlays as well: it is where their image and height come from.
      classes: [
        'wonderbox',
        'wonderDeity',
        'wonderRays',
        'wonder_bar',
        'wonder_level',
        'wonder_belief',
        'wonder_level_display',
        'resUpgrade',
        'multipleDonationImg',
        'wonderOtherPlayers',
        'table02',
        'donor',
        'cityName',
        'donated',
        'priests',
        'convertion',
        'percentage',
      ],
    },
  ]

  it.each(CONTRACTS)('$file keeps the classes $rule selects on', ({ file, classes }) => {
    const source = webSources.find((s) => s.path.endsWith(file))
    expect(source, `${file} not found`).toBeDefined()
    const missing = classes.filter((cls) => !source!.text.includes(cls))
    expect(missing).toEqual([])
  })

  /**
   * The skin decides where the slider sits, and the two families of rules
   * disagree: `.sliderinput .sliderbg` wants `relative`, while
   * `#setScientists #sliderbg` and `#setWorkers #sliderbg` want `absolute`
   * with a `top`/`left`. An inline `position` beats both, which is exactly how
   * the academy's track ended up in the flow under its own number field.
   *
   * The transparent range input keeps its own `position: absolute` -- it is
   * layered over the track by this component, not by the skin -- so the check
   * looks only at the wrapper element.
   */
  it('does not position the slider wrapper inline', () => {
    const slider = webSources.find((s) => s.path.endsWith('components/Slider.tsx'))!
    const wrapper = slider.text.slice(
      slider.text.indexOf('<div className="sliderbg"'),
      slider.text.indexOf('<input'),
    )
    expect(wrapper, 'the sliderbg wrapper was not found').not.toBe('')
    expect(wrapper).not.toMatch(/position:\s*['"](relative|absolute|fixed)['"]/)
  })
})

/**
 * Artwork the client asks for by name has to be on disk.
 *
 * `design/` is Vite's `publicDir` (apps/web/vite.config.ts:14), so `/skin/x`
 * is `design/skin/x` and nothing else. A path that misses draws a 0x0 image --
 * no console error worth noticing, no failing request in the eyes of the app,
 * just a card with a hole in it. That is how the shipyard shipped with every
 * unit picture missing: ships live in `characters/fleet/`, not
 * `characters/military/`, and only the *ram* exists under both names.
 *
 * Interpolated paths can only be checked as far as their literal directory
 * prefix, so the two sprite roots get their own assertion below.
 */
describe('every skin asset the client names exists', () => {
  const DESIGN = join(ROOT, '../design')
  const QUOTED = /(['"`])(\/(?:skin|img|css|js|media)\/[^'"`\n]*?)\1/g
  const TEMPLATED = /`(\/(?:skin|img|css|js|media)\/[^`\n]*)`/g

  const literal: { path: string; from: string }[] = []
  const templated: { path: string; from: string }[] = []
  for (const { path: from, text } of webSources) {
    for (const [, , url] of text.matchAll(QUOTED)) {
      if (!url!.includes('${')) literal.push({ path: url!, from })
    }
    for (const [, url] of text.matchAll(TEMPLATED)) {
      if (url!.includes('${')) templated.push({ path: url!, from })
    }
  }

  it('names a realistic number of them', () => {
    expect(literal.length).toBeGreaterThan(20)
  })

  it('has none that is missing from design/', () => {
    const missing = literal
      .filter(({ path }) => !existsSync(join(DESIGN, path)))
      .map(({ path, from }) => `${path} (${from.slice(WEB_SRC.length + 1)})`)
    expect(missing).toEqual([])
  })

  it('builds every interpolated path inside a directory that exists', () => {
    const missing = templated
      .map(({ path, from }) => ({
        dir: path.slice(0, path.lastIndexOf('/', path.indexOf('${'))),
        path,
        from,
      }))
      .filter(({ dir }) => !existsSync(join(DESIGN, dir)))
      .map(({ path, from }) => `${path} (${from.slice(WEB_SRC.length + 1)})`)
    expect(missing).toEqual([])
  })

  /**
   * The one distinction a prefix check cannot make. Land units are
   * `military/120x100/{class}_r_120x100.gif` and `military/x60_y60/y60_{class}
   * _faceright.gif`; ships are `fleet/120x100/{class}_r_120x100.gif` and
   * `fleet/60x60/{class}_faceright.gif` -- a different folder *and* a different
   * naming scheme (shipyard.php:44, cityMilitary.php:94).
   */
  it('draws ships from the fleet sprites and land units from the military ones', () => {
    const recruit = webSources.find((s) => s.path.endsWith('screens/Recruit.tsx'))!
    expect(recruit.text).toMatch(/action === 'fleet' \? 'fleet' : 'military'/)

    const military = readdirSync(join(DESIGN, 'skin/characters/military'))
    const fleet = readdirSync(join(DESIGN, 'skin/characters/fleet'))
    expect(military, 'land units have no 60x60 folder, only x60_y60').not.toContain('60x60')
    expect(fleet, 'ships have no x60_y60 folder, only 60x60').not.toContain('x60_y60')

    const misc = webSources.find((s) => s.path.endsWith('screens/Misc.tsx'))!
    expect(misc.text).toContain('/skin/characters/fleet/60x60/')
    expect(misc.text).toContain('/skin/characters/military/x60_y60/')
  })
})

/**
 * The staff panel is its own app, and stays that way.
 *
 * The four checks above are all scoped to `apps/web/src` and stay that way too:
 * the panel is Turkish-only by design and has no `t()` layer, so the
 * "no untranslated prose" guard would fail on every one of its labels, and it
 * loads none of the legacy skin. What is worth machine-checking instead is the
 * separation itself.
 */
const ADMIN_SRC = join(ROOT, 'apps/admin/src')
const adminSources = walk(ADMIN_SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }))

describe('the panel does not leak into the player bundle', () => {
  it('has its own sources', () => {
    expect(adminSources.length).toBeGreaterThan(5)
  })

  /**
   * Anything the game imports can end up in the bundle a player downloads.
   * `@izariam/shared/admin` is a subpath for exactly this reason -- a barrel
   * re-export would very likely survive tree-shaking, since a top-level
   * `z.object(...)` is not provably side-effect-free.
   */
  it('is not referenced anywhere in apps/web/src', () => {
    const offenders = webSources
      .filter(({ text }) => /\/api\/admin|izariam_admin_|@izariam\/shared\/admin/.test(text))
      .map(({ path }) => path.slice(WEB_SRC.length + 1))
    expect(offenders).toEqual([])
  })

  it('keeps the admin contracts off the shared barrel', () => {
    const barrel = readFileSync(join(ROOT, 'packages/shared/src/index.ts'), 'utf8')
    expect(barrel).not.toContain('./admin.js')
  })
})

/**
 * Every admin route has a caller in the panel.
 *
 * The same guard the player actions get, and it catches the same thing: an
 * endpoint that exists, is authenticated, and is reachable by nothing.
 */
describe('every admin endpoint is reachable from the panel', () => {
  const routerSource = readFileSync(join(ROOT, 'apps/api/src/routes/admin.ts'), 'utf8')
  const routes = [
    ...routerSource.matchAll(
      /admin\w*Router\.(?:get|post|patch|delete)\(\s*'([^']+)'/g,
    ),
  ]
    .map((m) => m[1]!)
    // The catch-all 404 is not an endpoint.
    .filter((path) => !path.includes('*'))

  const clientText = adminSources.map((s) => s.text).join('\n')

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(10)
  })

  it.each(routes)('%s has a caller', (route) => {
    // `/players/:id/ban` is written as a template in the client, so the path is
    // matched in pieces around its parameters.
    const [head, ...rest] = route.split(/\/:[^/]+/)
    expect(clientText).toContain(head)
    // The segment *after* the id -- `/ban`, `/reset-link`, `/resources` -- is
    // what tells one nested endpoint from another. Checking only the head means
    // `/players` alone satisfies every route beneath it, so a whole endpoint
    // could ship with no caller at all and this guard would still pass.
    for (const tail of rest) if (tail) expect(clientText).toContain(tail)
  })
})

/**
 * Two lookups the panel degrades silently without.
 *
 * Both maps have a fallback -- an unknown audit action renders as the dotted
 * identifier the server writes, an unknown error code renders as a generic
 * sentence -- so a missing entry never throws, never logs, and shows a
 * moderator something they cannot act on.
 */
describe('the panel can say every word the server can', () => {
  const adminServer = [
    ...walk(join(ROOT, 'apps/api/src/admin')),
    join(ROOT, 'apps/api/src/routes/admin.ts'),
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

  it('has a Turkish label for every audited action', () => {
    // Only action strings look like this: a dotted, lower-case pair.
    const actions = [
      ...new Set([...adminServer.matchAll(/action:\s*'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]!)),
    ]
    expect(actions.length).toBeGreaterThan(5)

    // Only the label map counts. Searching the whole file would be satisfied by
    // the `case 'player.grant_resources':` in `auditDetail`, which is a
    // *detail* renderer -- the row would still show a dotted identifier in the
    // İşlem column.
    const source = readFileSync(join(ADMIN_SRC, 'lib/audit.ts'), 'utf8')
    const start = source.indexOf('AUDIT_ACTIONS: Record<AdminAuditAction, string> = {')
    expect(start, 'AUDIT_ACTIONS was not found').toBeGreaterThan(-1)
    const labels = source.slice(start, source.indexOf('\n}\n', start))

    const missing = actions.filter((action) => !labels.includes(`'${action}'`))
    expect(missing).toEqual([])
  })

  it('has a Turkish message for every failure code', () => {
    const codes = [
      ...new Set(
        [...adminServer.matchAll(/(?:AdminFailure|PlayerFailure|ResourceFailure)\('([a-z_]+)'\)/g)]
          .map((m) => m[1]!),
      ),
    ]
    expect(codes.length).toBeGreaterThan(5)

    const messages = readFileSync(join(ADMIN_SRC, 'lib/format.ts'), 'utf8')
    const missing = codes.filter((code) => !messages.includes(`${code}:`))
    expect(missing).toEqual([])
  })
})
