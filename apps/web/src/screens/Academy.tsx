/**
 * The academy, izariam/views/view/academy.php.
 *
 * One slider that moves citizens into and out of research. The projections
 * beside it were recomputed in JavaScript as the legacy thumb moved and are
 * recomputed here the same way, from the same three constants the template
 * inlined:
 *
 *   citizens  = (free + scientists) - assigned
 *   research  = plusResearch * assigned          per hour
 *   income    = saldo - goldPerScientist * (assigned - current)
 *
 * `gold_need` is `scientists_gold_need + 3`, which is 6 or 9 -- three more
 * than the tick actually charges. The projection therefore overstates the cost
 * of every scientist by 3 gold/hour, and the number settles to the real one
 * after the form is submitted and the page reloads. Reproduced.
 *
 * The maximum is the smaller of the academy's capacity and everyone available,
 * so a small academy caps the slider below the town's spare population.
 */

import { scientistsByLevel } from '@izariam/rules'
import { useState } from 'react'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { Slider } from '../components/Slider.js'
import { num, t } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen } from './context.js'

export const AcademyScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const { town, townDerived, derived } = ctx
  const level = town.buildings.bySlot[position]?.level ?? 0

  const available = town.peoples + town.scientists
  const max = Math.floor(Math.min(scientistsByLevel(level), available))
  const [assigned, setAssigned] = useState(Math.floor(town.scientists))

  // scientists_gold_need is 3 with research 3_13 and 6 without; the template
  // then adds 3 to whichever it is. See the note above.
  const goldPerScientist =
    ((ctx.state.user.research.levels['3_13'] ?? 0) > 0 ? 3 : 6) + 3
  const projectedCitizens = Math.floor(available - assigned)
  const projectedResearch = Math.floor(derived.plusResearch * assigned)
  const projectedIncome = Math.floor(
    townDerived.saldo - goldPerScientist * (assigned - Math.floor(town.scientists)),
  )

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <BuildingHeader
          position={position}
          state={ctx.state}
          town={town}
          now={ctx.now}
          clockOffset={ctx.clockOffset}
          onNavigate={ctx.navigate}
          onFinished={ctx.refresh}
          act={ctx.act}
          />
        <form
          id="setScientists"
          onSubmit={(e) => {
            e.preventDefault()
            void ctx.act('workers', {
              townId: town.id,
              screen: 'academy',
              slot: position,
              scientists: assigned,
            })
          }}
        >
          <div className="contentBox01h">
            <h3 className="header">
              <span className="textLabel">{t('assign_workers')}</span>
            </h3>
            <div className="content">
              <ul>
                <li className="citizens">
                  <span className="textLabel">{t('peoples')}: </span>
                  <span className="value" id="valueCitizens">
                    {num(projectedCitizens)}
                  </span>
                </li>
                <li className="scientists">
                  <span className="textLabel">{t('scientists')}: </span>
                  <span className="value" id="valueWorkers">
                    {num(assigned)}
                  </span>
                </li>
                <li className="gain">
                  <span className="textLabel">{t('research_achievement')}: </span>
                  <div id="gainPoints">
                    <img id="lightbulb" src="/skin/layout/bulb-on.gif" width={14} height={21} alt="" />
                  </div>
                  <div style={{ position: 'absolute', top: '22px', left: '145px' }}>
                    <span id="valueResearch" className="positive overcharged">
                      +{projectedResearch}
                    </span>
                    <span className="timeUnit">{t('per_hour')}</span>
                  </div>
                </li>
                <li className="costs">
                  <span className="textLabel">{t('income_town')}: </span>
                  <span id="valueWorkCosts" className="negative">
                    {projectedIncome}
                  </span>{' '}
                  <img src="/skin/resources/icon_gold.gif" title={t('gold')} alt={t('gold')} />
                  <span className="timeUnit"> {t('per_hour')}</span>
                </li>
              </ul>

              <div id="overchargeMsg" className="status nooc ocready oced">
                {t('overloaded')}
              </div>
              <Slider value={assigned} max={max} onChange={setAssigned} overcharge />

              <a
                className="setMin"
                href="#reset"
                title={t('no_scientists')}
                onClick={(e) => {
                  e.preventDefault()
                  setAssigned(0)
                }}
              >
                <span className="textLabel">{t('min')}</span>
              </a>
              <a
                className="setMax"
                href="#max"
                title={t('max_scientists')}
                onClick={(e) => {
                  e.preventDefault()
                  setAssigned(max)
                }}
              >
                <span className="textLabel">{t('max')}</span>
              </a>
              <input
                name="s"
                id="inputScientists"
                className="textfield"
                maxLength={4}
                autoComplete="off"
                value={assigned}
                onChange={(e) => setAssigned(Math.min(max, Number(e.target.value) || 0))}
              />
              <div className="centerButton">
                <input
                  id="inputWorkersSubmit"
                  className={assigned === Math.floor(town.scientists) ? 'button' : 'buttonChanged'}
                  type="submit"
                  value={t('confirm')}
                />
              </div>
              {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
            </div>
            <div className="footer" />
          </div>
        </form>

        <div id="goToResearch" className="contentBox01h">
          <h3 className="header">
            {t('research_points')}: {Math.floor(ctx.state.user.research.points)}
            <img
              alt={t('research_points')}
              src="/skin/resources/icon_research.gif"
              className="iconResearch"
              style={{ float: 'none' }}
            />
          </h3>
          <div className="centerButton">
            <a
              className="button"
              href={hashFor('researchAdvisor')}
              onClick={(e) => {
                e.preventDefault()
                ctx.navigate(hashFor('researchAdvisor'))
              }}
            >
              {t('research_advisor')}
            </a>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}
