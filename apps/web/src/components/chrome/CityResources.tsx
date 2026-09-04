/**
 * Current-town resources, reproducing izariam/views/game_index.php:427-517.
 *
 * Separate box from #globalResources and positioned 110px away from it
 * (design/skin/ik_common_0.4.5.css:198-199 vs :234); merging the two leaves
 * every item stacked at one point, because `#globalResources li` is
 * absolutely positioned with no offsets of its own.
 *
 * Three traps the skin sets:
 *   - crystal's li class is `.glass`, but the value span is `#value_crystal`
 *     (ik_common_0.4.5.css:222-223 vs game_index.php:486)
 *   - there is no <a> here, unlike the global box
 *   - the warning classes are `storage_danger` / `storage_full`, on the value
 *     span, not the li
 *
 * Values tick client-side between requests: the server stamps the stock and
 * the per-second rate, and this extrapolates. Nothing polls.
 */

import { useEffect, useState } from 'react'

import { num, t, tf } from '../../lib/i18n.js'

/**
 * li class -> value span id -> `trade_resource` index. Crystal is the odd one
 * out on the first two: `.glass` but `#value_crystal`.
 */
const RESOURCE_ROWS = [
  { cls: 'wood', id: 'value_wood', key: 'wood', label: 'wood', trade: 0 },
  { cls: 'wine', id: 'value_wine', key: 'wine', label: 'wine', trade: 1 },
  { cls: 'marble', id: 'value_marble', key: 'marble', label: 'marble', trade: 2 },
  { cls: 'glass', id: 'value_crystal', key: 'crystal', label: 'crystal', trade: 3 },
  { cls: 'sulfur', id: 'value_sulfur', key: 'sulfur', label: 'sulfur', trade: 4 },
] as const

/**
 * The tradegood production line only appears on island-context pages
 * (game_index.php:455). Everywhere else the tooltip omits it entirely, even
 * though the number is just as true -- Island_Model is simply not loaded.
 */
const ISLAND_CONTEXT = new Set([
  'island',
  'worldmap_iso',
  'tradegood',
  'resource',
  'plunder',
  'colonize',
  'transport',
  'sendSpy',
])

type ResourceKey = (typeof RESOURCE_ROWS)[number]['key']

export interface ResourceRates {
  wood: number
  wine: number
  marble: number
  crystal: number
  sulfur: number
}

interface Props {
  stock: Record<ResourceKey, number>
  /** Units per second, already including every multiplier. */
  rates: ResourceRates
  capacity: number
  freePopulation: number
  maxPopulation: number
  actionPoints: number
  maxActionPoints: number
  /** Server time when `stock` was sampled, epoch seconds. */
  sampledAt: number
  /** Server clock minus client clock, seconds. Corrects for skew. */
  clockOffset: number

  /** The page key, which decides whether the tradegood line is shown. */
  page: string
  /** This town's island trade good, 0..4. */
  tradeResource: number
  /** Trade-good units per second, for the line above. */
  tradegoodRate: number
  /** Units of each resource on the branch office's shelf, sell offers only. */
  onSale: Record<ResourceKey, number>
  /** Research 2_3, wealth. Without it the four mined goods render disabled. */
  hasWealth: boolean
}

/** The skin colours the number at 75% and again when the store is full. */
function storageClass(value: number, capacity: number): string {
  if (capacity <= 0) return ''
  if (value >= capacity) return 'storage_full'
  if (value / capacity >= 0.75) return 'storage_danger'
  return ''
}

export function CityResources({
  stock,
  rates,
  capacity,
  freePopulation,
  maxPopulation,
  actionPoints,
  maxActionPoints,
  sampledAt,
  clockOffset,
  page,
  tradeResource,
  tradegoodRate,
  onSale,
  hasWealth,
}: Props) {
  const [now, setNow] = useState(() => Date.now() / 1000 + clockOffset)

  useEffect(() => {
    setNow(Date.now() / 1000 + clockOffset)
    // 2s matches the legacy counter interval (game_index.php:793).
    const timer = window.setInterval(() => setNow(Date.now() / 1000 + clockOffset), 2000)
    return () => window.clearInterval(timer)
  }, [clockOffset, sampledAt])

  const elapsed = Math.max(0, now - sampledAt)

  return (
    <div id="cityResources">
      <h3>{t('city_resources')}</h3>
      <ul className="resources">
        <li className="population" title={t('inhabitants')}>
          <span className="textLabel">{t('inhabitants')}: </span>
          <span id="value_inhabitants" style={{ display: 'block', width: '80px' }}>
            {Math.floor(freePopulation)} ({Math.floor(maxPopulation)})
          </span>
        </li>
        <li className="actions" title={t('actions')}>
          <span className="textLabel">{t('actions')}: </span>
          <span id="value_maxActionPoints">
            {actionPoints}/{maxActionPoints}
          </span>
        </li>

        {RESOURCE_ROWS.map((row) => {
          const projected = Math.min(stock[row.key] + rates[row.key] * elapsed, capacity)
          const label = t(row.label)
          // Wood is never gated; the other four grey out when the store is
          // empty *and* wealth is unresearched.
          const disabled = row.key !== 'wood' && !hasWealth && stock[row.key] === 0
          // Wood always shows its own production line. The other four show one
          // only when this island's trade good is that resource, and only on a
          // page that has loaded the island.
          const showProduction =
            row.key === 'wood' || (ISLAND_CONTEXT.has(page) && tradeResource === row.trade)
          const rate = row.key === 'wood' ? rates.wood : tradegoodRate

          return (
            <li key={row.key} className={disabled ? `${row.cls} disabled` : row.cls}>
              <span className="textLabel">{label}: </span>
              <span id={row.id} className={storageClass(projected, capacity)}>
                {num(projected)}
              </span>
              <div className="tooltip" style={row.key === 'wood' ? undefined : { lineHeight: '13px' }}>
                {showProduction && (
                  <>
                    <span className="textLabel">{tf('hourly_production', label)}: </span>
                    {Math.floor(rate * 3600)}
                    <br />
                  </>
                )}
                <span className="textLabel">
                  {t('capacity')} {label}:{' '}
                </span>
                {num(capacity)}
                {onSale[row.key] > 0 && (
                  <>
                    <br />
                    <span className="textLabel">{t('market')}: </span>
                    {num(onSale[row.key])}
                  </>
                )}
                {/* Hardcoded English in the legacy too (game_index.php:451). */}
                {row.key !== 'wood' && !hasWealth && (
                  <>
                    <br />
                    <span className="researchNeededWarning">{t('research_needed')}</span>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
