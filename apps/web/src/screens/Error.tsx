/**
 * izariam/views/view/error.php.
 *
 * Where 20 controller guards land, and where the router sends any page key it
 * does not know -- so it is the first screen worth having.
 *
 * The legacy body is almost entirely commented out: three successive attempts
 * at showing the actual error sit inside a PHP comment block, leaving one
 * hardcoded "page not found" line for every failure. Reproduced as written,
 * with the detail the router does know added under it, because a router that
 * swallows its own reason is worse than useless during a port.
 *
 * `<center>` inside `<ul class="error">` is the legacy's markup, invalid and
 * load-bearing: `ul.error li` is styled as a list row and the centring comes
 * from the deprecated element, not from CSS.
 */

import { t } from '../lib/i18n.js'
import type { Screen } from './context.js'

export const ErrorScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    {/* The view emits its own empty box on top of the backToCity sidebox the
        dispatcher supplies (view/error.php:1). */}
    <div id="information" className="dynamic" />
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('error')}</h1>
      </div>
      <div className="contentBox01h">
        <h3 className="header">
          <span className="textLabel">{t('error_messages')}</span>
        </h3>
        <div className="content">
          <ul className="error">
            <center>
              <li>{t('page_not_found')}</li>
              {ctx.route.raw.length > 0 && (
                <li>
                  <span className="textLabel">{ctx.route.page}</span> / {ctx.route.raw.join(' / ')}
                </li>
              )}
            </center>
          </ul>
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)
