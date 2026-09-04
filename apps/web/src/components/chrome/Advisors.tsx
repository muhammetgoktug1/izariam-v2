/**
 * The four advisor portraits, reproducing izariam/views/game_index.php:518-570.
 *
 * The icon's class is a single concatenated token -- `normalactive`, not
 * `normal active`. design/skin/ik_common_0.4.5.css:284-320 defines exactly
 * `a.normal`, `a.normalactive`, `a.premium`, `a.premiumactive` per advisor; a
 * space turns it into two classes that match nothing and the portrait
 * disappears.
 *
 * The military advisor never lights up: the legacy simply omits the active
 * branch at game_index.php:534, even though the skin defines an alert state
 * for it. Reproduced rather than corrected.
 */

import { t } from '../../lib/i18n.js'

interface Advisor {
  id: string
  page: string
  premiumPage: string
  labelKey: string
  titleKey: string
  active: boolean
}

interface Props {
  hasPremium: boolean
  newTownMessages: number
  newUserMessages: number
  researchAvailable: boolean
  onNavigate: (page: string) => void
}

export function Advisors({
  hasPremium,
  newTownMessages,
  newUserMessages,
  researchAvailable,
  onNavigate,
}: Props) {
  const advisors: Advisor[] = [
    {
      id: 'advCities',
      page: 'tradeAdvisor',
      premiumPage: 'premiumTradeAdvisor',
      labelKey: 'trade_advisor_name',
      titleKey: 'trade_advisor_title',
      active: newTownMessages > 0,
    },
    {
      id: 'advMilitary',
      page: 'militaryAdvisorMilitaryMovements',
      premiumPage: 'premiumMilitaryAdvisor',
      labelKey: 'military_advisor_name',
      titleKey: 'military_advisor_title',
      // Always inactive, matching game_index.php:534.
      active: false,
    },
    {
      id: 'advResearch',
      page: 'researchAdvisor',
      premiumPage: 'premiumResearchAdvisor',
      labelKey: 'research_advisor_name',
      titleKey: 'research_advisor_title',
      active: researchAvailable,
    },
    {
      id: 'advDiplomacy',
      page: 'diplomacyAdvisor',
      premiumPage: 'premiumDiplomacyAdvisor',
      labelKey: 'diplomacy_advisor_name',
      titleKey: 'diplomacy_advisor_title',
      active: newUserMessages > 0,
    },
  ]

  const go = (page: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    onNavigate(page)
  }

  return (
    <div id="advisors">
      {/* `overviews` is missing from the language file, in the legacy too, and
          CI's Language::line() returns FALSE for an unknown key -- so this
          heading was blank in the original and blank here until the key was
          added to HARDCODED. */}
      <h3>{t('overviews')}</h3>
      <ul>
        {advisors.map((a) => {
          const base = hasPremium ? 'premium' : 'normal'
          return (
            <li key={a.id} id={a.id}>
              <a
                href={`#/${a.page}`}
                title={t(a.titleKey)}
                className={a.active ? `${base}active` : base}
                onClick={go(a.page)}
              >
                <span className="textLabel">{t(a.labelKey)}</span>
              </a>
              {hasPremium ? (
                <a
                  className="pluslink"
                  href={`#/${a.premiumPage}`}
                  title={t('to_view')}
                  onClick={go(a.premiumPage)}
                >
                  <span className="textLabel">{t('to_view')}</span>
                </a>
              ) : (
                <a
                  className="plusteaser"
                  href="#/premiumDetails"
                  title={t('to_view')}
                  onClick={go('premiumDetails')}
                >
                  <span className="textLabel">{t('to_view')}</span>
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
