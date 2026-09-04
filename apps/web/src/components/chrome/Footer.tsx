/**
 * Reproduces izariam/views/game_index.php:653-657.
 *
 * `#footer .copyright{float:left}` and `#footer a{margin:0 10px;color:#edd090}`
 * (design/skin/ik_common_0.4.5.css:331-335), so the span and the anchor both
 * have to be there for the bar to lay out.
 *
 * The legacy gives two of its anchors the same id="gflink"; not reproduced,
 * duplicate ids buy nothing. Its external links are not reproduced either.
 */

import { t } from '../../lib/i18n.js'

interface Props {
  onNavigate: (page: string) => void
}

export function Footer({ onNavigate }: Props) {
  return (
    <div id="footer">
      <span className="copyright">
        &copy; iZariam 2012. {t('all_rights_reserved')}{' '}
        <a
          href="#/credits"
          style={{ margin: 0 }}
          onClick={(e) => {
            e.preventDefault()
            onNavigate('credits')
          }}
        >
          {t('credits')}
        </a>
      </span>
    </div>
  )
}
