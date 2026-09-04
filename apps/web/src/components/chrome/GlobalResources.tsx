/**
 * Empire-wide totals: ambrosia, cargo ships, gold.
 * Reproduces izariam/views/game_index.php:406-425.
 *
 * Two details the skin depends on:
 *
 * - the icon is painted on the <a>, not the <li>
 *   (`.gold a{background:url(layout/btn_gold.jpg)}`,
 *    design/skin/ik_common_0.4.5.css:253-254), so the anchor cannot be dropped
 * - `.textLabel` is the *caption*, and the skin parks it at left:-9999px
 *   (ik_common_0.4.5.css:235-236). The number lives in a bare sibling span
 *   with an id. Putting the value inside .textLabel hides it.
 */

import { num, t } from '../../lib/i18n.js'

interface Props {
  ambrosia: number
  /** Ships not currently on a mission. */
  freeTransports: number
  totalTransports: number
  gold: number
  onNavigate: (page: string) => void
}

export function GlobalResources({
  ambrosia,
  freeTransports,
  totalTransports,
  gold,
  onNavigate,
}: Props) {
  const go = (page: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    onNavigate(page)
  }

  return (
    <div id="globalResources">
      <h3>{t('global_resources')}</h3>
      <ul>
        <li className="ambrosiaNoSpin" title={`${num(ambrosia)} ${t('ambrosy')}`}>
          <a href="#/premium" onClick={go('premium')}>
            <span className="textLabel">{t('ambrosy')}:</span>
            <span id="accountAmbrosia">{num(ambrosia)}</span>
          </a>
        </li>
        <li className="transporters" title={t('button_transporters_name')}>
          <a href="#/merchantNavy" onClick={go('merchantNavy')}>
            <span className="textLabel">{t('button_transporters_name')}:</span>
            <span id="accountTransporter">
              {freeTransports} ({totalTransports})
            </span>
          </a>
        </li>
        <li className="gold" title={`${num(gold)} ${t('gold')}`}>
          <a href="#/finances" onClick={go('finances')}>
            <span className="textLabel">{t('gold')}:</span>
            <span id="value_gold">{num(gold)}</span>
          </a>
        </li>
      </ul>
    </div>
  )
}
