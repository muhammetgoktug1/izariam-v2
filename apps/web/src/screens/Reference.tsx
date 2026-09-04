/**
 * The reference screens: wonders, buildings, the changelog and the credits.
 *
 * izariam/views/view/{wonderDetail,buildingDetail,version,credits}.php. All
 * four are static or table-driven, so they share a file.
 */

import { BUILDINGS } from '@izariam/gamedata'
import { MIRACLES, buildingCost } from '@izariam/rules'

import { buildingClass, buildingDesc, buildingName } from '../lib/buildings.js'
import { formatTime } from '../lib/format.js'
import { num, t } from '../lib/i18n.js'
import type { Screen } from './context.js'

/**
 * Durations and cooldowns come from `MIRACLES` rather than a second copy of
 * `wonder_duration_by_type` / `wonder_cooldown_by_type` (data_model.php:1542,
 * :1561): this screen used to be the only reader of those tables, and now the
 * activation rules read them too. One copy, so a screen cannot advertise a
 * cooldown the server does not enforce.
 */
function span(kind: 'duration' | 'cooldown', type: number): string {
  const spec = MIRACLES[type]
  if (!spec) return ''
  const seconds = kind === 'duration' ? spec.duration : spec.cooldown
  return seconds > 0 ? formatTime(seconds) : ''
}

/**
 * wonderDetail.php. The legacy redirects anything outside 1..8 to wonder 1 --
 * with a guard written `$id >= 9 or $id <= 0` against `$id`, which is never
 * assigned before the test, so in practice every request falls through to the
 * else branch and reads `$param1` instead. Clamped here rather than redirected.
 */
export const WonderDetailScreen: Screen = ({ ctx, sideboxes }) => {
  const id = Math.min(8, Math.max(1, ctx.route.params[0] || 1))

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="wonderDetail">
          <h1>{t('wonder_description')}</h1>
        </div>
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t(`wonder_${id}`)}</span>
          </h3>
          <div className="content">
            <div className="desc">
              <table cellPadding={0} cellSpacing={0}>
                <tbody>
                  <tr>
                    <td>
                      <p>
                        <img src={`/skin/wonder2/wonder${id}.gif`} alt="" />
                      </p>
                    </td>
                    <td>
                      {/* Hardcoded English in the legacy too. */}
                      <h4>{t('description')}</h4>
                      <p>{t(`wonder${id}_desc`)}</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="effect">
              <table className="effectTable">
                <tbody>
                  <tr>
                    <th>{t('level')}</th>
                    <th>{t('effect')}</th>
                    <th>{t('duration')}</th>
                    <th>{t('cooldown')}</th>
                  </tr>
                  {[1, 2, 3, 4, 5].map((level) => (
                    <tr key={level} className={level === 2 || level === 4 ? 'alt' : undefined}>
                      <td>{level}</td>
                      <td>{t(`wonder${id}_level${level}`)}</td>
                      <td>{span('duration', id)}</td>
                      <td>{span('cooldown', id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

/**
 * buildingDetail.php -- the encyclopedia entry for one building: its blurb and
 * a cost table for every level it can reach.
 *
 * The costs are priced with *no* research and *no* workshop, so they are the
 * list prices rather than what this player would pay. That is what the legacy
 * did: it passes an empty research object into building_cost.
 */
export const BuildingDetailScreen: Screen = ({ ctx, sideboxes }) => {
  const type = Math.min(27, Math.max(1, ctx.route.params[0] || 1))
  const table = BUILDINGS[String(type)]
  const maxLevel = table?.max_level ?? 0
  const bare = { levels: {}, points: 0, branchSeen: {} }

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{buildingName(type)}</h1>
          <p>{buildingDesc(type)}</p>
        </div>
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('cost')}</span>
          </h3>
          <div className="content">
            <div className="buildingPictureImg">
              <img src={`/skin/buildings/y100/${buildingClass(type)}.gif`} alt="" />
            </div>
            <table cellPadding={0} cellSpacing={0} className="table01">
              <thead>
                <tr>
                  <th>{t('level')}</th>
                  <th>{t('wood')}</th>
                  <th>{t('wine')}</th>
                  <th>{t('marble')}</th>
                  <th>{t('crystal')}</th>
                  <th>{t('sulfur')}</th>
                  <th>{t('build_time')}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxLevel }, (_, i) => {
                  const cost = buildingCost(type, i, bare, {})
                  return (
                    <tr key={i} className={i % 2 === 1 ? 'alt' : undefined}>
                      <td>{i + 1}</td>
                      <td>{cost.wood > 0 ? num(cost.wood) : '-'}</td>
                      <td>{cost.wine > 0 ? num(cost.wine) : '-'}</td>
                      <td>{cost.marble > 0 ? num(cost.marble) : '-'}</td>
                      <td>{cost.crystal > 0 ? num(cost.crystal) : '-'}</td>
                      <td>{cost.sulfur > 0 ? num(cost.sulfur) : '-'}</td>
                      <td>{formatTime(cost.time)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

/**
 * version.php -- a hand-written changelog with one entry, 0.1.0. It is markup,
 * not data, so it is reproduced as markup.
 */
export const VersionScreen: Screen = ({ sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <h1>{t('changelog')}</h1>
      <table cellPadding={0} cellSpacing={0} className="table01">
        <tbody>
          <tr>
            <th>{t('version')}</th>
            <th>{t('date')}</th>
            <th>{t('description')}</th>
          </tr>
          <tr>
            <td className="version">0.1.0</td>
            <td className="version">07.03.2012</td>
            <td className="desc">
              <ul>
                <li>Made install script</li>
                <li>Started Admin Panel (added new row in database)</li>
                <li>Alphabetical reorder to view_model</li>
                <li>Building construction list full fixed</li>
                <li>Reordered to alphabetical order actions controller and translated</li>
                <li>
                  Improved - Options page redesigned and full translated
                  <ul>
                    <li>Can disable Tutorial</li>
                    <li>Can Change your password</li>
                    <li>Can Change your username</li>
                    <li>Show errors</li>
                    <li>Edit show town details</li>
                    <li>Add deletion template</li>
                  </ul>
                </li>
                <li>Fixed - Show world error when try to login or register in a world which does not exist</li>
                <li>Updated - iZariam HomePage</li>
              </ul>
            </td>
          </tr>
          {/* The port itself, so the page is not a museum piece. */}
          <tr className="alt">
            <td className="version">0.2.0</td>
            <td className="version">2026</td>
            <td className="desc">
              <ul>
                <li>Rewritten as a TypeScript monorepo: React client, Express API, PostgreSQL</li>
                <li>Rules engine ported from the PHP models and pinned by golden fixtures</li>
                <li>Skin reused verbatim from the 2012 design tree</li>
              </ul>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </>
)

/** credits.php. A static table of names; the `face.js` it loads is decorative. */
export const CreditsScreen: Screen = ({ sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription" style={{ height: '60px', minHeight: 0 }}>
        <h1>{t('credits')}</h1>
      </div>
      <div>
        <div>
          <img src="/img/logo.png" alt="iZariam" />
        </div>
      </div>
    </div>
  </>
)
