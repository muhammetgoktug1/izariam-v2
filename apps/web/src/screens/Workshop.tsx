/**
 * The five bonus workshops: forester, stonemason, glassblowing, winegrower,
 * alchemist (izariam/views/view/{forester,...}.php).
 *
 * All five legacy files are the same 57 lines with four tokens changed -- the
 * sprite, the header string, the bonus-row label and the base-production label
 * -- so they are one component and a table.
 *
 * LEGACY BUG, reproduced: every one of them reads `resource_production`, the
 * *wood* rate, and calls it the base production. Four of the five are trade
 * good buildings, so the stonemason shows the town's wood output and labels it
 * marble. The percentages beside it are consistent with that number, so the
 * whole panel is internally coherent and externally wrong. Flagged as
 * `workshopsShowWoodProduction` in the rules config.
 *
 * The bar widths are the legacy's arithmetic verbatim, off-by-one included:
 * the base row is `99 - level*2` percent wide against a "100.00%" title, and
 * the bonus row is `level*2 - 1`. At level 0 the bonus bar is -1% wide.
 *
 * Two of the five (stonemason, winegrower) hardcode Russian strings with no
 * language key behind them. There is no English to fall back to, so the
 * building's own name stands in for the header.
 */

import { LEGACY_QUIRKS } from '@izariam/rules'

import { num, t } from '../lib/i18n.js'
import { BuildingHeader } from '../components/building/BuildingHeader.js'
import type { Screen, ScreenContext } from './context.js'
import { buildingName } from '../lib/buildings.js'

interface WorkshopSpec {
  /** Building type, for the sprite name and the level lookup. */
  type: number
  sprite: string
  /** Language key for the panel header, or null to use the building's name. */
  headerKey: string | null
  /** Language key for the "basic production" row. Four use one key, the
   *  alchemist uses a different one that says the same thing. */
  baseKey: string
}

const WORKSHOPS: Record<string, WorkshopSpec> = {
  forester: { type: 16, sprite: 'forester', headerKey: 'forester_statistic', baseKey: 'basic_production' },
  stonemason: { type: 17, sprite: 'stonemason', headerKey: null, baseKey: 'basic_production' },
  glassblowing: { type: 18, sprite: 'glassblowing', headerKey: 'glasblower_statistic', baseKey: 'basic_production' },
  winegrower: { type: 19, sprite: 'winegrower', headerKey: null, baseKey: 'basic_production' },
  alchemist: { type: 20, sprite: 'alchemist', headerKey: 'sulfur_extraction', baseKey: 'base_productivity' },
}

export const WorkshopScreen: Screen = ({ ctx, sideboxes }) => {
  const spec = WORKSHOPS[ctx.route.page]
  if (!spec) return null
  return (
    <>
      {sideboxes}
      <Workshop ctx={ctx} spec={spec} />
    </>
  )
}

function Workshop({ ctx, spec }: { ctx: ScreenContext; spec: WorkshopSpec }) {
  const position = ctx.route.params[0]
  const level = ctx.town.buildings.bySlot[position]?.level ?? 0

  // The wood rate, whatever this workshop actually boosts. See the note above.
  const production = Math.floor(
    (LEGACY_QUIRKS.workshopsShowWoodProduction
      ? ctx.townDerived.resourceProductionBonus
      : ctx.townDerived.tradegoodProductionBonus) * 3600,
  )
  const bonus = (production / 100) * level * 2
  const total = production + bonus

  const header = spec.headerKey ? t(spec.headerKey) : buildingName(spec.type)

  return (
    <div id="mainview">
      <div id="bonusBuilding">
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
          <div className="buildingPictureImg">
            <img src={`/skin/img/city/small/building_${spec.sprite}.gif`} alt="" />
          </div>
          <h3 className="header">
            <span className="textLabel">{header}</span>
          </h3>
          <div className="content">
            <table cellSpacing={0} border={0} style={{ margin: '0 auto 0px' }}>
              <colgroup>
                <col width="150" />
                <col width="70" />
                <col width="%" />
              </colgroup>
              <tbody>
                <tr>
                  <th className="brownHeader" colSpan={3} />
                </tr>
                <tr>
                  <td className="col1Style">
                    <label>{t(spec.baseKey)}: </label>
                  </td>
                  <td className="col2Style">
                    <span title={t(spec.baseKey)}>{num(production)}</span>
                  </td>
                  <td className="col3Style">
                    <div className="green" style={{ width: `${99 - level * 2}%` }} title="100.00%" />
                  </td>
                </tr>
                <tr className="alt">
                  <td className="col1Style">
                    <label>{buildingName(spec.type)}: </label>
                  </td>
                  <td className="col2Style">
                    <span title={buildingName(spec.type)}>{num(bonus)}</span>
                  </td>
                  <td className="col3Style">
                    <div
                      className="yellow"
                      style={{ width: `${level * 2 - 1}%` }}
                      title={`+${level * 2}.00%`}
                    />
                  </td>
                </tr>
                <tr className="buildingResult">
                  <td className="col1Style">
                    <img src="/skin/layout/sigma.gif" alt="" />
                  </td>
                  <td className="col2Style">
                    <span title={t('total')}>
                      <b>{num(total)}</b>
                    </span>
                  </td>
                  <td className="col3Style">
                    <div className="green" style={{ width: '99%' }} title={`${100 + level * 2}.00%`} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="footer" />
        </div>
      </div>
    </div>
  )
}
