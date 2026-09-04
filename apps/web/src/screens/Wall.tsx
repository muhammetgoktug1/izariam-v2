/**
 * The town wall, izariam/views/view/wall.php.
 *
 * A read-only stat card. Every string in the legacy file is hardcoded Russian
 * with no language key behind it, so the English here has no original to defer
 * to; the numbers are the contract.
 *
 * Two of the four figures are literals in the legacy as well: the terrain
 * attack does 12 damage at 30% accuracy on every wall at every level. Only
 * health, armour and the garrison limit move.
 *
 * `wall_data_by_level` is the one balance table nothing in the game reads --
 * there is no combat model in the legacy, so these numbers are displayed and
 * never used.
 */

import { wallDataByLevel } from '@izariam/rules'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { num, t } from '../lib/i18n.js'
import type { Screen } from './context.js'

export const WallScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const level = ctx.town.buildings.bySlot[position]?.level ?? 0
  const wall = wallDataByLevel(level)

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
          <h3 className="header">{t('info')}</h3>
          <div className="content">
            <div className="bgWall">
              <div id="wallInfoBox">
                <div className="infoBoxHeader" />
                <div className="infoBoxContent">
                  <div className="weapon">
                    <div className="weaponName">{t('terrain_attack')}</div>
                    <span className="textLabel">{t('damage')}</span>
                    <b>12</b>
                    <span className="textLabel">{t('accuracy')}</span>
                    <div className="damageFocusContainer" title="30%">
                      <div className="damageFocus" style={{ width: '30%' }} />
                    </div>
                  </div>
                  <span className="textLabel">{t('health')}</span>
                  <b>{wall.health}</b>
                  <br />
                  <span className="textLabel">{t('armour')}</span>
                  <b>{wall.reservation ?? 0}</b>
                  <br />
                  <span className="textLabel">{t('garrison_limit')}</span>
                  <b>{num(ctx.townDerived.garrisonLimit)}</b>
                  <br />
                </div>
                <div className="infoBoxFooter" />
              </div>
            </div>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}
