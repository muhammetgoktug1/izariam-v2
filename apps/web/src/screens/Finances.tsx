/**
 * The balance sheet, izariam/views/view/finances.php.
 *
 * Per-town income and scientist wages, then four bar tables for army upkeep.
 * Two of those four are the same table twice -- "basic cost" and "supply
 * costs" are copy-pasted, same variables, same markup -- so they render from
 * one helper here and appear twice, as they did.
 *
 * The arithmetic is the template's, and it disagrees with the tick in two
 * places:
 *
 * - income is `peoples * 3`, using only the *unassigned* citizens, while the
 *   tick pays for the whole population. A town with most of its people at work
 *   reads far poorer here than it is.
 * - fleet upkeep sums unit ids 16..22, leaving out 23, the cargo ship -- which
 *   is the one unit almost every player owns. The tick charges for it.
 *
 * Both are display-only and both are reproduced.
 */

import { unitCost, type LevelsByType } from '@izariam/rules'

import { num, t } from '../lib/i18n.js'
import type { Screen, ScreenContext } from './context.js'

/** Land units 1..14 and ships 16..22 -- the cargo ship, 23, is omitted. */
const LAND = Array.from({ length: 14 }, (_, i) => i + 1)
const SHIPS = Array.from({ length: 7 }, (_, i) => i + 16)

function upkeep(ctx: ScreenContext, ids: number[], useResearch: boolean): number {
  let total = 0
  for (const town of ctx.state.towns) {
    const levels: LevelsByType = ctx.derived.towns[town.id]?.levels ?? {}
    for (const id of ids) {
      const count = town.army[id] ?? 0
      if (count > 0) total += unitCost(id, ctx.state.user.research, levels, useResearch).gold * count
    }
  }
  return total
}

export const FinancesScreen: Screen = ({ ctx, sideboxes }) => {
  const scientistGold = (ctx.state.user.research.levels['3_13'] ?? 0) > 0 ? 3 : 6

  const rows = ctx.state.towns.map((town) => {
    const income = town.peoples * 3
    const wages = town.scientists * scientistGold * -1
    return { town, income, wages }
  })
  const totalIncome = rows.reduce((n, r) => n + r.income, 0)
  const totalWages = rows.reduce((n, r) => n + r.wages, 0)
  const net = totalIncome + totalWages

  const armyBase = upkeep(ctx, LAND, false)
  const armyReduced = upkeep(ctx, LAND, true)
  const fleetBase = upkeep(ctx, SHIPS, false)
  const fleetReduced = upkeep(ctx, SHIPS, true)
  const allUpkeep = (armyReduced + fleetReduced) * -1

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <h1>{t('balances')}</h1>

        <table cellSpacing={0} id="balance" className="table01">
          <tbody>
            <tr>
              <td className="sigma">{t('amount_gold')}</td>
              <td className="value res" />
              <td className="value res" />
              <td className="value res">{num(ctx.state.user.gold)}</td>
            </tr>
          </tbody>
        </table>

        <table cellSpacing={0} id="balance" className="table01">
          <tbody>
            <tr>
              <th className="city">
                <img src="/skin/layout/icon-city2.gif" alt={t('town')} />
              </th>
              <th>{t('income')}</th>
              <th>{t('scientists')}</th>
              <th>{t('amount')}</th>
            </tr>
            {rows.map(({ town, income, wages }) => (
              <tr key={town.id}>
                <td className="city">{town.name}</td>
                <td className="value res">{num(income)}</td>
                <td className="value res">
                  {wages < 0 ? <span className="negative">{num(wages)}</span> : num(wages)}
                </td>
                <td className="value res">{num(income + wages)}</td>
              </tr>
            ))}
            <tr className="result">
              <td className="sigma">
                <img src="/skin/layout/sigma.gif" alt="" />
              </td>
              <td className="value res">{num(totalIncome)}</td>
              <td className="value res">
                {totalWages < 0 ? (
                  <span className="negative">{num(totalWages)}</span>
                ) : (
                  num(totalWages)
                )}
              </td>
              <td className="value res">{num(net)}</td>
            </tr>
          </tbody>
        </table>

        {/* The same table twice, under two headings. See the note above. */}
        <UpkeepTable
          title={t('basic_cost')}
          armyBase={armyBase}
          armyReduced={armyReduced}
          fleetBase={fleetBase}
          fleetReduced={fleetReduced}
        />
        <UpkeepTable
          title={t('supply_costs')}
          armyBase={armyBase}
          armyReduced={armyReduced}
          fleetBase={fleetBase}
          fleetReduced={fleetReduced}
        />

        <table cellSpacing={0} cellPadding={0} id="upkeepReductionTable" className="table01">
          <tbody>
            <tr>
              <th colSpan={4}>{t('total')}</th>
            </tr>
            <tr>
              <td className="reason">{t('income')}</td>
              <td className="costs" />
              <td className="bar">
                <div className="greenBarDiv barBorder" style={{ width: '99%' }} title={t('income')}>
                  <div className="brownBarDiv" style={{ width: '100%' }} title={t('income')} />
                </div>
              </td>
              <td className="hidden">{num(net)}</td>
            </tr>
            <tr>
              <td className="reason"> - {t('upkeep')}</td>
              <td className="costs" />
              <td className="bar">
                <div className="redBarDiv barBorder" style={{ width: '99%' }} title={t('cost')}>
                  <div
                    className="brownBarDiv"
                    style={{
                      width:
                        net > 0 && -allUpkeep > 0
                          ? `${100 - Math.floor((-allUpkeep / net) * 100)}%`
                          : '100%',
                    }}
                    title={t('income')}
                  />
                </div>
              </td>
              <td className={allUpkeep < 0 ? 'hidden negative' : 'hidden'}>{num(allUpkeep)}</td>
            </tr>
            <tr className="result">
              <td className="reason">
                <img src="/skin/layout/sigma.gif" alt={t('total')} />
              </td>
              <td className="costs" />
              <td className="bar" />
              <td className={net + allUpkeep < 0 ? 'hidden negative' : 'hidden'}>
                {num(net + allUpkeep)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

interface UpkeepProps {
  title: string
  armyBase: number
  armyReduced: number
  fleetBase: number
  fleetReduced: number
}

function UpkeepTable({ title, armyBase, armyReduced, fleetBase, fleetReduced }: UpkeepProps) {
  /** The template prints 100% when either figure is zero, so a player with no
   *  army is told the researches saved them nothing rather than everything. */
  const percent = (reduced: number, base: number) =>
    reduced > 0 && base > 0 ? Math.floor((reduced / base) * 100) : 100

  const pair = (label: string, base: number, reduced: number) => (
    <>
      <tr>
        <td className="reason">{label}</td>
        <td className="costs">{num(base)}</td>
        <td className="bar">
          <div className="greenBarDiv barBorder" style={{ width: '99%' }} title={t('cost')}>
            <div className="brownBarDiv" style={{ width: '100%' }} title={t('cost')} />
          </div>
        </td>
        <td className="hidden" />
      </tr>
      <tr className="altbottomLine">
        <td className="reason">
          - {t('researches')} ({100 - percent(reduced, base)}%)
        </td>
        <td className="boldcosts">{num(reduced)}</td>
        <td className="bar">
          <div className="greenBarDiv barBorder" style={{ width: '99%' }} title={t('cost')}>
            <div
              className="brownBarDiv"
              style={{ width: `${percent(reduced, base)}%` }}
              title={t('cost')}
            />
          </div>
        </td>
        <td className="hidden">{num(reduced)}</td>
      </tr>
    </>
  )

  return (
    <table cellSpacing={0} cellPadding={0} id="upkeepReductionTable" className="table01">
      <tbody>
        <tr>
          <th colSpan={4}>{title}</th>
        </tr>
        {pair(t('troops'), armyBase, armyReduced)}
        {pair(t('fleets'), fleetBase, fleetReduced)}
        <tr className="result">
          <td className="reason">
            <img src="/skin/layout/sigma.gif" alt={t('total')} />
          </td>
          <td className="costs" />
          <td className="bar" />
          <td className="hidden">{num(armyReduced + fleetReduced)}</td>
        </tr>
      </tbody>
    </table>
  )
}
