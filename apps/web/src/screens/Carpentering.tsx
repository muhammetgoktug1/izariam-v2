/**
 * The carpenter's workshop, izariam/views/view/carpentering.php.
 *
 * Three identical tables showing the same discount applied to buildings, land
 * units and ships. Only the first one includes the research discounts --
 * pulley (2_2, 2%), geometry (2_6, 4%) and spirit level (2_11, 8%) -- because
 * only building costs get them; unit costs are reduced by the workshop alone.
 *
 * The percentages are absolute, not multiplicative: a level 10 workshop and
 * all three researches give 100 - 14 - 10 = 76%. That is what the cost
 * functions do too, so the display and the arithmetic agree.
 *
 * The bar widths are the legacy's, off-by-ones included: the outer green bar
 * on the research row is `base - 1` wide, on the building row `research - 1`,
 * and the inner brown bar on the building row is `building - 1` -- one less
 * than the number printed beside it.
 */

import { buildingLevel, BUILDING } from '@izariam/rules'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { t } from '../lib/i18n.js'
import type { Screen } from './context.js'

/** Research node -> percentage points off building costs. */
const RESEARCH_DISCOUNTS: { key: string; points: number }[] = [
  { key: '2_2', points: 2 },
  { key: '2_6', points: 4 },
  { key: '2_11', points: 8 },
]

export const CarpenteringScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const workshop = buildingLevel(ctx.town, BUILDING.CARPENTERING)

  let research = 0
  for (const r of RESEARCH_DISCOUNTS) {
    if ((ctx.state.user.research.levels[r.key] ?? 0) > 0) research += r.points
  }

  const afterResearch = 100 - research
  const afterBuilding = afterResearch - workshop
  // Units and ships skip the research row entirely.
  const unitsPercent = 100 - workshop

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div id="reductionBuilding">
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

          <Box title={`${t('carpenter_statistics')} - ${t('buildings')}`}>
            <BaseRow />
            <tr className="alt">
              <td className="col1Style">
                <b>-</b> {t('researches')} ({research}.00%):
              </td>
              <td className="col2Style">
                <span title={t('total')}>
                  <b>{afterResearch}.00%</b>
                </span>
              </td>
              <td className="col3Style">
                <div className="greenBarDiv barBorder" style={{ width: '99%' }} title={t('cost')}>
                  <div
                    className="brownBarDiv"
                    style={{ width: `${afterResearch}%` }}
                    title={t('cost')}
                  />
                </div>
              </td>
            </tr>
            <tr>
              <td className="col1Style">
                <b>-</b> {t('building21_name')} ({workshop}.00%):
              </td>
              <td className="col2Style">
                <span title={t('total')}>
                  <b>{afterBuilding}.00%</b>
                </span>
              </td>
              <td className="col3Style">
                <div
                  className="greenBarDiv barBorder"
                  style={{ width: `${afterResearch - 1}%` }}
                  title={t('cost')}
                >
                  <div
                    className="brownBarDiv"
                    style={{ width: `${afterBuilding - 1}%` }}
                    title={t('cost')}
                  />
                </div>
              </td>
            </tr>
          </Box>

          <Box title={`${t('carpenter_statistics')} - ${t('units')}`}>
            <BaseRow />
            <UnitRow workshop={workshop} percent={unitsPercent} />
          </Box>

          <Box title={`${t('carpenter_statistics')} - ${t('ships')}`}>
            <BaseRow />
            <UnitRow workshop={workshop} percent={unitsPercent} />
          </Box>
        </div>
      </div>
    </>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="contentBox01h">
      <div className="buildingPictureImg">
        <img src="/skin/img/city/small/building_carpentering.gif" alt="" />
      </div>
      <h3 className="header">
        <span className="textLabel">{title}</span>
      </h3>
      <div className="content">
        <table cellSpacing={0} border={0} style={{ margin: '0 auto 0px' }}>
          <tbody>
            <tr>
              <th className="brownHeader" colSpan={3} />
            </tr>
            {children}
          </tbody>
        </table>
      </div>
      <div className="footer" />
    </div>
  )
}

function BaseRow() {
  return (
    <tr>
      <td className="col1Style">{t('basic_cost')}:</td>
      <td className="col2Style">
        <span title={t('total')}>
          <b>100.00%</b>
        </span>
      </td>
      <td className="col3Style">
        <div className="brownBarDiv barBorder" style={{ width: '99%' }} title={t('cost')} />
      </td>
    </tr>
  )
}

function UnitRow({ workshop, percent }: { workshop: number; percent: number }) {
  return (
    <tr className="alt">
      <td className="col1Style">
        <b>-</b> {t('building21_name')} ({workshop}.00%):
      </td>
      <td className="col2Style">
        <span title={t('total')}>
          <b>{percent}.00%</b>
        </span>
      </td>
      <td className="col3Style">
        <div className="greenBarDiv barBorder" style={{ width: '99%' }} title={t('cost')}>
          <div className="brownBarDiv" style={{ width: `${percent}%` }} title={t('cost')} />
        </div>
      </td>
    </tr>
  )
}
