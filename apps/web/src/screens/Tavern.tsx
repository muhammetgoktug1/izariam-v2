/**
 * The tavern, izariam/views/view/tavern.php.
 *
 * One control that sets how much wine is served per hour, 0..tavern level.
 * Every serving level adds 60 to happiness and consumes
 * `wineByTavernLevel(n)` grapes per hour.
 *
 * The legacy drives it with both a slider and a `<select>`, wired to each
 * other; both are kept, because the select is the one that carries the hourly
 * consumption figure in its option labels.
 *
 * `wine_by_tavern_level` is one of the reproduced defects: past level 40 the
 * operands in `818 + ((40 - level) * 60)` are the wrong way round and
 * consumption starts falling, going negative around 54. The tavern's cost
 * table stops at 39, so the slider can never reach it -- but the curve is
 * identical everywhere it is defined.
 */

import { wineByTavernLevel } from '@izariam/rules'
import { useState } from 'react'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { Slider } from '../components/Slider.js'
import { happinessClass } from '../lib/happiness.js'
import { num, t } from '../lib/i18n.js'
import type { Screen } from './context.js'

export const TavernScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const level = ctx.town.buildings.bySlot[position]?.level ?? 0
  const [amount, setAmount] = useState(ctx.town.tavernWine)

  // Serving n levels of wine is worth 60n happiness; the class on the face
  // below is recomputed against the projected total, as the legacy's
  // valueChange handler did.
  const bonus = amount * 60
  const projected = ctx.townDerived.happiness - ctx.town.tavernWine * 60 + bonus

  return (
    <>
      {sideboxes}
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
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('prepare_drinks')}</span>
          </h3>
          <div className="content">
            <form
              id="wineAssignForm"
              onSubmit={(e) => {
                e.preventDefault()
                void ctx.act('tavern', { townId: ctx.town.id, slot: position, amount })
              }}
            >
              <ul id="units">
                <li className="unit">
                  <div className="unitinfo">
                    <h4>{t('prepare_wine')}</h4>
                    <img
                      src="/skin/resources/wine-big.gif"
                      style={{ marginLeft: '10px' }}
                      alt=""
                    />
                    <p>{t('prepare_wine_desc')}</p>
                  </div>

                  <div className="sliderinput">
                    <Slider
                      value={amount}
                      max={level}
                      onChange={setAmount}
                      bgId="sliderbg_wine"
                      valueId="actualValue_wine"
                      thumbId="sliderthumb_wine"
                      to={326}
                    />
                    <a
                      className="setMin"
                      href="#reset"
                      onClick={(e) => {
                        e.preventDefault()
                        setAmount(0)
                      }}
                    >
                      <span className="textLabel">{t('min')}</span>
                    </a>
                    <a
                      className="setMax"
                      href="#max"
                      onClick={(e) => {
                        e.preventDefault()
                        setAmount(level)
                      }}
                    >
                      <span className="textLabel">{t('max')}</span>
                    </a>
                  </div>

                  <div className="forminput">
                    <a
                      className="setMax"
                      href="#max"
                      onClick={(e) => {
                        e.preventDefault()
                        setAmount(level)
                      }}
                    >
                      <span className="textLabel">{t('max')}</span>
                    </a>
                    <div className="centerButton">
                      <input type="submit" value={t('cheers')} className="button" />
                    </div>
                    <div id="citySatisfaction" className={happinessClass(projected)} />
                  </div>

                  <div id="serve" className="textfield">
                    <select
                      id="wineAmount"
                      name="amount"
                      size={1}
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                    >
                      {Array.from({ length: level + 1 }, (_, i) => (
                        <option key={i} value={i}>
                          {i === 0
                            ? t('no_wine')
                            : `${num(wineByTavernLevel(i))} ${t('wine')} ${t('per_hour')}`}
                        </option>
                      ))}
                    </select>
                    <span className="bonus">
                      +
                      <span id="bonus" className="value">
                        {bonus}
                      </span>{' '}
                      {t('happy_citizens')}
                    </span>
                    <br />
                    <span className="savedWine">
                      <span id="savedWine">&nbsp;</span>
                    </span>
                  </div>
                </li>
              </ul>
              {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
            </form>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}
