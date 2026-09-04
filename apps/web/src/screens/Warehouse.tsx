/**
 * The warehouse, izariam/views/view/warehouse.php.
 *
 * A four-column table -- insured, uninsured, total, capacity -- for the five
 * resources. "Insured" is the stock a raid could not take:
 *
 *   safe = (warehouseCount * 80 + 100) * premiumCapacityMultiplier
 *
 * counted per resource, so a town with two warehouses protects 260 of *each*.
 * Note it uses the warehouse *count*, not their levels, while `capacity` is
 * driven by the levels -- so a single level-30 warehouse insures the same 180
 * as a level-1 one.
 *
 * Nothing reads the insured figure: there is no raid model in the legacy, so
 * this is a promise the game never has to keep.
 *
 * Every string is hardcoded Russian in the original; there are no language
 * keys to defer to.
 */

import { RESOURCES } from '@izariam/rules'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { num, t, tf } from '../lib/i18n.js'
import type { Screen } from './context.js'

/** Resource -> the icon file, which calls crystal "glass". */
const ICON: Record<string, string> = {
  wood: 'wood',
  wine: 'wine',
  marble: 'marble',
  crystal: 'glass',
  sulfur: 'sulfur',
}

export const WarehouseScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const { town, townDerived, derived } = ctx

  // derive() owns this now, because Athene's miracle multiplies it and the
  // miracle's expiry is not something a screen should be checking.
  const safe = townDerived.safeResources
  const capacity = townDerived.capacity

  const column = (value: (resource: (typeof RESOURCES)[number]) => number, cls?: string) => (
    <table cellPadding={0} cellSpacing={0}>
      <tbody>
        {RESOURCES.map((r) => (
          <tr key={r}>
            <td>
              <img src={`/skin/resources/icon_${ICON[r]}.gif`} title={t(r)} alt={t(r)} />
            </td>
            <td>{cls ? <span className={cls}>{num(value(r))}</span> : num(value(r))}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('goods_in_warehouse')}</span>
          </h3>
          <div className="content">
            <p style={{ padding: '10px 10px 0 18px' }} />
            {townDerived.warehouseCount > 1 && (
              <p style={{ padding: '10px 10px 0 18px' }}>
                {tf(
                  'warehouse_levels_text',
                  townDerived.warehouseCount,
                  townDerived.warehouseLevels.join(', '),
                )}
                <br />
              </p>
            )}
            <table className="table01">
              <thead>
                <tr>
                  <th>{t('insured')}</th>
                  <th>{t('uninsured')}</th>
                  <th>{t('total')}</th>
                  <th>{t('capacity')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="sicher">{column(() => safe, 'secure')}</td>
                  <td className="klaubar">
                    {column((r) => Math.max(0, town.resources[r] - safe), 'insecure')}
                  </td>
                  <td className="gesamt">{column((r) => town.resources[r])}</td>
                  <td className="capacity">{column(() => capacity)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}
