/**
 * The barracks and the shipyard, izariam/views/view/{barracks,shipyard}.php.
 *
 * Same shape, different unit range and different gate tables, so one component
 * and two tables.
 *
 * Each unit is behind two independent gates:
 *
 * - a research node, which decides whether the unit appears at all;
 * - a building level, which decides whether the *form* appears. Below it the
 *   unit is still listed, with its stats and costs, and "building level too
 *   low" where the input would be.
 *
 * The two do not agree. The shipyard, for instance, shows unit 16 -- the ram
 * ship -- with no research gate at all, then blocks recruitment behind
 * shipyard level 1, so a town with a shipyard under construction sees the whole
 * catalogue and can order none of it.
 *
 * `max` is the largest number the town can currently afford, computed per
 * resource and then minimised. The legacy seeds it at 999999 and only lowers
 * it for resources the unit actually costs, so a free unit would offer 999999.
 */

import type { UnitStats } from '@izariam/gamedata'
import { levelsByType, unitCost } from '@izariam/rules'
import { useState } from 'react'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { Slider } from '../components/Slider.js'
import { armyClass, armyDesc, armyName } from '../lib/buildings.js'
import { formatTime } from '../lib/format.js'
import { num, t } from '../lib/i18n.js'
import type { Screen, ScreenContext } from './context.js'

/** Land units: research node that unlocks it, barracks level that enables it. */
const LAND_GATES: Record<number, { research?: string; level: number }> = {
  1: { research: '4_3', level: 4 },
  2: { research: '4_12', level: 12 },
  3: { level: 1 },
  4: { research: '4_3', level: 6 },
  5: { level: 2 },
  6: { research: '4_6', level: 7 },
  7: { research: '4_11', level: 13 },
  8: { research: '4_4', level: 3 },
  9: { research: '4_7', level: 8 },
  10: { research: '4_13', level: 14 },
  11: { research: '3_12', level: 10 },
  12: { research: '3_15', level: 11 },
  13: { research: '2_9', level: 5 },
  14: { research: '3_8', level: 9 },
}

/** Ships. Unit 16 has no research gate; every ship needs shipyard level 1. */
const SHIP_GATES: Record<number, { research?: string; level: number }> = {
  16: { level: 1 },
  17: { research: '1_8', level: 4 },
  18: { research: '1_12', level: 5 },
  19: { research: '1_2', level: 2 },
  20: { research: '1_9', level: 3 },
  21: { research: '1_13', level: 6 },
  22: { research: '3_14', level: 7 },
}

/** The affordability cap, seeded at 999999 as the legacy seeds it. */
function affordable(ctx: ScreenContext, cost: UnitStats): number {
  let max = 999999
  const limit = (need: number, have: number) => {
    if (need > 0) max = Math.min(max, Math.floor(have / need))
  }
  limit(cost.wood, ctx.town.resources.wood)
  limit(cost.sulfur, ctx.town.resources.sulfur)
  limit(cost.wine, ctx.town.resources.wine)
  limit(cost.crystal, ctx.town.resources.crystal)
  limit(cost.peoples, ctx.town.peoples)
  return Math.max(0, max)
}

export const BarracksScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <Recruit ctx={ctx} gates={LAND_GATES} buildingType={5} action="army" />
  </>
)

export const ShipyardScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <Recruit ctx={ctx} gates={SHIP_GATES} buildingType={4} action="fleet" />
  </>
)

interface Props {
  ctx: ScreenContext
  gates: Record<number, { research?: string; level: number }>
  buildingType: number
  action: 'army' | 'fleet'
}

function Recruit({ ctx, gates, buildingType, action }: Props) {
  /* Ships live in their own sprite folder, and only `ram` exists in both:
     `characters/military/120x100/ram_r_120x100.gif` is the battering ram,
     `characters/fleet/120x100/ship_ram_r_120x100.gif` the ship. Sharing one
     path left every ship card with a broken image (shipyard.php:44). */
  const sprites = action === 'fleet' ? 'fleet' : 'military'
  const position = ctx.route.params[0]
  const levels = levelsByType(ctx.town)
  const buildingLevel = levels[buildingType] ?? 0
  const [counts, setCounts] = useState<Record<number, number>>({})

  const head = ctx.town.buildQueue[0]
  const upgrading = head?.slot === position && ctx.town.buildStartedAt != null

  const offered = Object.entries(gates)
    .map(([id, gate]) => ({ id: Number(id), gate }))
    .filter(
      ({ gate }) => !gate.research || (ctx.state.user.research.levels[gate.research] ?? 0) > 0,
    )

  return (
    <div id="mainview">
      <BuildingHeader
        position={position}
        state={ctx.state}
        town={ctx.town}
        now={ctx.now}
        clockOffset={ctx.clockOffset}
        onNavigate={ctx.navigate}
        onFinished={ctx.refresh}
        act={ctx.act}
        />
      <form
        id="buildForm"
        onSubmit={(e) => {
          e.preventDefault()
          void ctx.act(action, {
            townId: ctx.town.id,
            slot: position,
            counts: Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0)),
          })
        }}
      >
        <div className="contentBox01h">
          <h3 className="header">{t('recruit_units')}</h3>
          <div className="content">
            <ul id="units">
              {offered.map(({ id, gate }) => {
                const cls = armyClass(id)
                const cost = unitCost(id, ctx.state.user.research, levels)
                const max = affordable(ctx, cost)
                const value = counts[id] ?? 0
                const tooLow = buildingLevel < gate.level

                return (
                  <li key={id} className={`unit ${cls}`}>
                    <div className="unitinfo">
                      <h4>{armyName(id)}</h4>
                      {/* game/unitDescription has a view but no controller and
                          no show_view case, so the legacy's link 404s. Kept as
                          the image without the link. */}
                      <img
                        src={`/skin/characters/${sprites}/120x100/${cls}_r_120x100.gif`}
                        alt=""
                      />
                      <div className="unitcount">
                        <span className="textLabel">{t('available')}: </span>
                        {num(ctx.town.army[id] ?? 0)}
                      </div>
                      <p>{armyDesc(id)}</p>
                    </div>
                    <label htmlFor={`textfield_${cls}`}>
                      {t('recruit')} {armyName(id)}
                    </label>
                    <div className="sliderinput">
                      <Slider
                        value={value}
                        max={max}
                        onChange={(v) => setCounts((c) => ({ ...c, [id]: v }))}
                        bgId={`sliderbg_${cls}`}
                        valueId={`actualValue_${cls}`}
                        thumbId={`sliderthumb_${cls}`}
                        to={326}
                      />
                      <a
                        className="setMin"
                        href="#reset"
                        title={t('reset_entry')}
                        onClick={(e) => {
                          e.preventDefault()
                          setCounts((c) => ({ ...c, [id]: 0 }))
                        }}
                      >
                        <span className="textLabel">{t('min')}</span>
                      </a>
                      <a
                        className="setMax"
                        href="#max"
                        title={t('recruit_max')}
                        onClick={(e) => {
                          e.preventDefault()
                          setCounts((c) => ({ ...c, [id]: max }))
                        }}
                      >
                        <span className="textLabel">{t('max')}</span>
                      </a>
                    </div>

                    {upgrading ? (
                      <div className="forminput">{t('is_upgrading')}</div>
                    ) : tooLow ? (
                      <div className="forminput">{t('building_low')}</div>
                    ) : (
                      <div className="forminput">
                        <input
                          className="textfield"
                          id={`textfield_${cls}`}
                          type="text"
                          name={String(id)}
                          size={4}
                          maxLength={4}
                          value={value}
                          onChange={(e) =>
                            setCounts((c) => ({ ...c, [id]: Number(e.target.value) || 0 }))
                          }
                        />
                        <a
                          className="setMax"
                          href="#max"
                          title={t('recruit_max')}
                          onClick={(e) => {
                            e.preventDefault()
                            setCounts((c) => ({ ...c, [id]: max }))
                          }}
                        >
                          <span className="textLabel">{t('max')}</span>
                        </a>
                        <input className="button" type="submit" value={`${t('recruit')}!`} />
                      </div>
                    )}

                    <div className="costs">
                      <h5>{t('cost')}:</h5>
                      <ul className="resources">
                        {cost.peoples > 0 && (
                          <li className="citizens" title={t('peoples')}>
                            <span className="textLabel">{t('peoples')}: </span>
                            {cost.peoples}
                          </li>
                        )}
                        {cost.wood > 0 && (
                          <li className="wood" title={t('wood')}>
                            <span className="textLabel">{t('wood')}: </span>
                            {num(cost.wood)}
                          </li>
                        )}
                        {cost.sulfur > 0 && (
                          <li className="sulfur" title={t('sulfur')}>
                            <span className="textLabel">{t('sulfur')}: </span>
                            {num(cost.sulfur)}
                          </li>
                        )}
                        {cost.wine > 0 && (
                          <li className="wine" title={t('wine')}>
                            <span className="textLabel">{t('wine')}: </span>
                            {num(cost.wine)}
                          </li>
                        )}
                        {cost.crystal > 0 && (
                          <li className="glass" title={t('crystal')}>
                            <span className="textLabel">{t('crystal')}: </span>
                            {num(cost.crystal)}
                          </li>
                        )}
                        {cost.gold > 0 && (
                          <li className="upkeep" title={t('upkeep_hour')}>
                            <span className="textLabel">{t('upkeep_hour')}: </span>
                            {num(cost.gold)}
                          </li>
                        )}
                        {cost.time > 0 && (
                          <li className="time" title={t('build_time')}>
                            <span className="textLabel">{t('build_time')}: </span>
                            {formatTime(cost.time)}
                          </li>
                        )}
                      </ul>
                    </div>
                  </li>
                )
              })}
            </ul>
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
      </form>
    </div>
  )
}
