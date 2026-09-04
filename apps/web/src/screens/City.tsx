/**
 * The city screen, reproducing izariam/views/view/city.php.
 *
 * The 15 slots are pinned by pixel coordinate in
 * design/skin/ik_city_0.4.5.css:33-58 off `#locations #position{n}`, so this
 * only has to emit matching ids. What it also has to emit -- and the first
 * cut did not -- is the inner div each slot carries:
 *
 *   built            <div class="buildingimg">   sprite per building type, :65-93
 *   queued, level 0  <div class="constructionSite">
 *   empty ground     <div class="flag">          colour comes from the terrain
 *                                                class, :53-58
 *
 * The <li> itself has no background (`#locations li{width:86px;height:43px}`)
 * and the <a> is a transparent hit box, so without that child the city renders
 * as bare terrain with invisible click targets.
 *
 * `#mainview` carries `phase{townHallLevel}`, which swaps the background art
 * as the town grows.
 */

import { Countdown } from '../components/Countdown.js'
import { buildingClass, buildingName } from '../lib/buildings.js'
import { t } from '../lib/i18n.js'
import { hashFor, isPage } from '../lib/routes.js'
import type { Screen } from './context.js'

/** Slots 1 and 2 are on the shore, 14 is the wall, the rest inland. */
function terrain(slot: number): string {
  if (slot === 14) return 'wall'
  return slot > 0 && slot < 3 ? 'shore' : 'land'
}

export const CityScreen: Screen = ({ ctx, sideboxes }) => {
  const { town, townDerived, chrome } = ctx
  const happiness = townDerived.happiness
  const unitCount = townDerived.landUnitCount
  const missionsLoading = chrome.missionsLoading
  // Slot 13 stays inert until research 2_13, bureaucracy.
  const bureaucracy = (ctx.state.user.research.levels['2_13'] ?? 0) > 0
  const buildEndsAt = chrome.towns[String(town.id)]?.buildEndsAt ?? null

  const onOpenSlot = (slot: number, type: number) => {
    const page = buildingClass(type)
    // An unbuilt slot opens the construction menu, which is a page of its own.
    ctx.navigate(isPage(page) ? hashFor(page, slot) : hashFor('buildingGround', slot))
  }
  const onBuildFinished = ctx.refresh

  const townHallLevel = town.buildings.bySlot[0]?.level ?? 0
  const head = town.buildQueue[0] ?? null
  const queueLength = town.buildQueue.length

  /**
   * `correct_buildings()` (player_model.php:378-393): every queued entry
   * stamps its type onto the empty slot it will occupy, not just the head.
   * That is what puts scaffolding on a plot that has been ordered but not
   * started -- `city.php:46` takes the `constructionSite` branch on
   * `type > 0 && level === 0`.
   */
  const queuedType: Record<number, number> = {}
  for (const entry of town.buildQueue) {
    const placed = town.buildings.bySlot[entry.slot]
    if ((placed?.type ?? 0) === 0 && queuedType[entry.slot] === undefined) {
      queuedType[entry.slot] = entry.type
    }
  }

  return (
    <>
      {sideboxes}
      <div id="mainview" className={`phase${townHallLevel}`}>
      <ul id="locations">
        {Array.from({ length: 15 }, (_, slot) => {
          const placed = town.buildings.bySlot[slot] ?? { type: 0, level: 0 }
          const building = head?.slot === slot
          // While a slot is queued the legacy paints the ordered building
          // rather than what stands there (player_model.php:378).
          const type = placed.type || queuedType[slot] || 0
          const level = placed.level
          const emptyGround = level === 0 && type === 0

          // Terrain only joins the class list when the ground is truly empty.
          const cls = emptyGround
            ? `${buildingClass(type)} ${terrain(slot)}`
            : `${buildingClass(type)} `

          // Bureaucracy gate: slot 13 is inert until research 2_13.
          if (slot === 13 && !bureaucracy) {
            return (
              <li key={slot} id="position13" className={cls}>
                <div />
                <a href="#" title={t('research_bureaucracy')} onClick={(e) => e.preventDefault()}>
                  <span className="textLabel">{t('research_bureaucracy')}</span>
                </a>
              </li>
            )
          }

          const inner = type > 0 ? (level > 0 ? 'buildingimg' : 'constructionSite') : 'flag'
          const name = buildingName(type)
          const title = type > 0 ? `${name} ${t('level')} ${level}` : name

          /**
           * Queue position badges, once more than one job is pending.
           *
           * Never on the plot that is actually being built: the legacy renders
           * that one from a separate branch (city.php:14-39) which emits the
           * countdown and no badge at all, and the badge loop lives only in
           * the other branch (:48-53). Both use `.timetofinish`, which the
           * skin pins to `top:50px;left:0` with no offset per sibling
           * (ik_city_0.0.1.css:115-117) -- so emitting both on one plot stacks
           * the "1." straight on top of the ":08".
           *
           * The match is by type rather than by slot, which is the legacy's
           * own quirk at :51 and is kept.
           */
          const badges =
            !building && queueLength > 1 && type > 0
              ? town.buildQueue
                  .map((entry, i) => (entry.type === type ? i + 1 : null))
                  .filter((n): n is number => n !== null)
              : []

          return (
            <li key={slot} id={`position${slot}`} className={cls}>
              <div className={inner} />
              <a
                href={`#/${buildingClass(type)}/${slot}`}
                title={title}
                onClick={(e) => {
                  e.preventDefault()
                  onOpenSlot(slot, type)
                }}
              >
                <span className="textLabel">
                  {title}
                  {building ? ` (${t('under_construction_short')})` : ''}
                </span>
              </a>

              {building && buildEndsAt != null && (
                <div className="timetofinish">
                  <span className="before" />
                  <span className="textLabel">{t('time_till')}: </span>
                  <span id="cityCountdown">
                    <Countdown endsAt={buildEndsAt} onFinish={onBuildFinished} />
                  </span>
                  <span className="after" />
                </div>
              )}

              {badges.map((n) => (
                <div key={n} className="timetofinish">
                  <span className="before" />
                  <span>{n}.</span>
                  <span className="after" />
                </div>
              ))}
            </li>
          )
        })}

        {/* Crowd sprites. The legacy shows an angry mob OR the calm town, never
            both (city.php:58-69). */}
        {happiness < 0 ? (
          <li className="protester" />
        ) : (
          <>
            {happiness >= 50 && <li className="beachboys" />}
            {unitCount > 0 && <li className="garnison" />}
          </>
        )}
        {missionsLoading > 0 && <li className="transporter" />}
      </ul>
      </div>
    </>
  )
}
