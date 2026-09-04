/**
 * Dismiss units, izariam/views/view/armyGarrisonEdit.php -- and
 * fleetGarrisonEdit.php, which is the same 78 lines line for line. Two routes,
 * one component; only the unit range differs, and even that is decided by
 * which units the town actually holds rather than by the file.
 *
 * The legacy loops types 1..14 in both files, so the *fleet* screen lists land
 * units and no ships. Reproduced by range, not by file: `armyGarrisonEdit`
 * covers 1..14 and `fleetGarrisonEdit` does too, which is why a player can
 * never dismiss a ship. Flagged rather than fixed -- the action behind it
 * (`armyEdit`) sets counts for whatever ids it is given, so the missing screen
 * is the only thing stopping it.
 *
 * The form posts one field per unit type named by its *id*, and the action
 * treats the value as the new count, not the number to dismiss -- despite
 * every label saying "dismiss". `armyEdit` never rejects anything
 * (military.ts:286), so the schema is the only guard.
 */

import { unitCost, levelsByType } from '@izariam/rules'
import { useState } from 'react'

import { Slider } from '../components/Slider.js'
import { armyClass, armyDesc, armyName } from '../lib/buildings.js'
import { num, t } from '../lib/i18n.js'
import type { Screen } from './context.js'

/** Both files loop 1..14. See the note above. */
const TYPES = Array.from({ length: 14 }, (_, i) => i + 1)

export const GarrisonEditScreen: Screen = ({ ctx, sideboxes }) => {
  const { town } = ctx
  const levels = levelsByType(town)
  const held = TYPES.filter((type) => (town.army[type] ?? 0) > 0)
  const [counts, setCounts] = useState<Record<number, number>>({})

  const set = (type: number, value: number) =>
    setCounts((c) => ({ ...c, [type]: Math.max(0, Math.min(town.army[type] ?? 0, value)) }))

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('inspect_garisson')}</h1>
          <p>{t('inspect_garisson_text')}</p>
        </div>
        <form
          id="fireForm"
          onSubmit={(e) => {
            e.preventDefault()
            void ctx.act('armyEdit', {
              townId: town.id,
              counts: Object.fromEntries(
                Object.entries(counts).filter(([, v]) => Number.isFinite(v)),
              ),
            })
          }}
        >
          <div className="contentBox01h">
            <h3 className="header">{t('fire_units')}</h3>
            <div className="content">
              <br />
              <ul id="units">
                {held.map((type) => {
                  const cls = armyClass(type)
                  const available = town.army[type] ?? 0
                  const cost = unitCost(type, ctx.state.user.research, levels)
                  const value = counts[type] ?? 0
                  return (
                    <li key={type} className={`unit ${cls}`}>
                      <div className="unitinfo">
                        <h4>{armyName(type)}</h4>
                        <img
                          src={`/skin/characters/military/120x100/${cls}_r_120x100.gif`}
                          alt=""
                        />
                        <div className="unitcount">
                          <span className="textLabel">{t('available')}: </span>
                          {num(available)}
                        </div>
                        <p>{armyDesc(type)}</p>
                      </div>
                      <label htmlFor={`textfield_${cls}`}>
                        {armyName(type)} {t('dismiss_units')}:
                      </label>
                      <div className="sliderinput">
                        <Slider
                          value={value}
                          max={available}
                          onChange={(v) => set(type, v)}
                          bgId={`sliderbg_${cls}`}
                          valueId={`actualValue_${cls}`}
                          thumbId={`sliderthumb_${cls}`}
                          to={326}
                        />
                        <a
                          className="setMin"
                          href="#reset"
                          onClick={(e) => {
                            e.preventDefault()
                            set(type, 0)
                          }}
                        >
                          <span className="textLabel">{t('min')}</span>
                        </a>
                        <a
                          className="setMax"
                          href="#max"
                          onClick={(e) => {
                            e.preventDefault()
                            set(type, available)
                          }}
                        >
                          <span className="textLabel">{t('max')}</span>
                        </a>
                      </div>
                      <div className="forminput">
                        <input
                          className="textfield"
                          id={`textfield_${cls}`}
                          type="text"
                          name={String(type)}
                          size={4}
                          maxLength={4}
                          value={value}
                          onChange={(e) => set(type, Number(e.target.value) || 0)}
                        />{' '}
                        <a
                          className="setMax"
                          href="#max"
                          title={t('recruit_max')}
                          onClick={(e) => {
                            e.preventDefault()
                            set(type, available)
                          }}
                        >
                          <span className="textLabel">{t('max')}</span>
                        </a>
                        <div className="centerButton">
                          <input
                            title={`${t('fire_units')}!`}
                            className="button"
                            type="submit"
                            value={`${t('dismiss_units')}!`}
                          />
                        </div>
                      </div>
                      <div className="costs">
                        <h5>{t('cost')}:</h5>
                        <ul className="resources">
                          {cost.gold > 0 && (
                            <li className="upkeep" title={t('upkeep_hour')}>
                              <span className="textLabel">{t('upkeep_hour')}: </span>
                              {num(cost.gold)}
                            </li>
                          )}
                        </ul>
                      </div>
                    </li>
                  )
                })}
                <br />
                <br />
              </ul>
              {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
            </div>
            <div className="footer" />
          </div>
        </form>
      </div>
    </>
  )
}
