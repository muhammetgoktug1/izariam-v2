/**
 * The town hall, izariam/views/view/townHall.php -- 262 lines and the fullest
 * report in the game: the town's stats, a population bar, the happiness ledger
 * both ways, and the corruption warning.
 *
 * It reimplements the progress block rather than including
 * building_description.php, and the only difference is the caption
 * (`expansion_progress` instead of `is_upgrading`). Reproduced as its own
 * block for that reason.
 *
 * The two stacked bars are laid out in pixels by the template, not by CSS, and
 * both use the same trick: give every segment a 60px floor and share the
 * remaining width in proportion. Carried over exactly, including:
 *
 * - the population bar divides by `peoples` (total citizens) while the segment
 *   for free citizens is `now_town->peoples` (unassigned ones), so the five
 *   segments do not sum to the whole;
 * - the wine bar's second segment is offset by `base_px`, a variable left over
 *   from the *bonus* bar above it -- it happens to be 60 as well, so the bug is
 *   invisible;
 * - "Points of action" is printed over a hardcoded 3, ignoring the town hall
 *   level that actually sets the cap.
 */

import { BUILDING, buildingCost, buildingLevel, levelsByType } from '@izariam/rules'
import { MAPS } from '@izariam/gamedata'

import { Countdown } from '../components/Countdown.js'
import { HurryButtons } from '../components/building/HurryButtons.js'
import { ProgressBar } from '../components/ProgressBar.js'
import { happinessClass, happinessName } from '../lib/happiness.js'
import { num, t } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'
import { buildingName } from '../lib/buildings.js'

/** Both bars: every segment gets 60px, the rest is shared proportionally. */
function segments(total: number, values: number[], width: number): number[] {
  const floor = 60
  const spare = width - floor * values.length
  const one = spare / 100
  return values.map((v) => Math.floor((v / total) * 100 * one + floor))
}

function resourceIcon(resource: number): string {
  const names = MAPS.resource_class_by_type as Record<string, string>
  return names[String(resource)] ?? 'wood'
}

export const TownHallScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <TownHall ctx={ctx} />
  </>
)

function TownHall({ ctx }: { ctx: ScreenContext }) {
  const position = ctx.route.params[0]
  const { town, townDerived, derived, island } = ctx
  const slot = town.buildings.bySlot[position] ?? { type: 0, level: 0 }

  const head = town.buildQueue[0]
  const building = head?.slot === position && town.buildStartedAt != null
  const cost = building
    ? buildingCost(slot.type, slot.level, ctx.state.user.research, levelsByType(town))
    : null
  const endsAt = cost ? town.buildStartedAt! + cost.time : 0

  const isCapital = town.id === ctx.state.user.capitalTownId
  const happy = townDerived.happiness
  const plus = townDerived.happinessBreakdown

  // Population bar. `totalPeoples` is the denominator; the first segment is
  // the unassigned citizens, which is a strict subset of it.
  const pop = segments(
    townDerived.totalPeoples,
    [town.peoples, town.workers, town.tradegood, town.scientists, town.templer],
    620,
  )
  const [freePx, workersPx, specialPx, researchPx, templerPx] = pop as [
    number,
    number,
    number,
    number,
    number,
  ]

  // Happiness bonus bar, three segments over 400px.
  const bonusTotal = plus.base + plus.research + plus.capital + plus.priests
  const [basePx, researchBonusPx, capitalPx, priestsPx] = segments(
    bonusTotal || 1,
    [plus.base, plus.research, plus.capital, plus.priests],
    400,
  ) as [number, number, number, number]

  const tavernLevel = buildingLevel(town, BUILDING.TAVERN)
  const tavernBonus = tavernLevel * 12
  const servingBonus = town.tavernWine * 60
  const wineTotal = tavernBonus + servingBonus
  const [tavernPx, servingPx] = segments(wineTotal || 1, [tavernBonus, servingBonus], 400) as [
    number,
    number,
  ]

  const nav = (hash: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    ctx.navigate(hash)
  }

  return (
    <div id="mainview">
      <h1 style={{ textAlign: 'center' }}>{buildingName(slot.type)}</h1>

      {building && cost && (
        <div id="upgradeInProgress">
          <div className="isUpgrading">{t('expansion_progress')}</div>
          <div className="buildingLevel">
            <span className="textLabel">{t('level')} </span>
            {slot.level}
          </div>
          <div className="nextLevel">
            <span className="textLabel">{t('next_level')} </span>
            {slot.level + 1}
          </div>
          <ProgressBar
            id="upgradeProgress"
            startsAt={town.buildStartedAt!}
            endsAt={endsAt}
            clockOffset={ctx.clockOffset}
          >
            <a
              className="cancelUpgrade"
              href={hashFor('demolition', position)}
              title={t('cancel')}
              onClick={nav(hashFor('demolition', position))}
            >
              <span className="textLabel">{t('cancel')}</span>
            </a>
          </ProgressBar>
          <div className="time" id="upgradeCountDown">
            <Countdown endsAt={endsAt} clockOffset={ctx.clockOffset} onFinish={ctx.refresh} />
          </div>
        </div>
      )}

      {/* The town hall draws its own progress block rather than using
          BuildingHeader, so the ambrosia buttons have to be repeated here --
          and outside #upgradeInProgress, which is a fixed 95px box
          (ik_common_0.4.5.css:1384). */}
      {building && cost && (
        <HurryButtons
          townId={town.id}
          slot={position}
          endsAt={endsAt}
          ambrosia={ctx.state.user.ambrosia}
          clockOffset={ctx.clockOffset}
          act={ctx.act}
          onNavigate={ctx.navigate}
        />
      )}

      <div id="CityOverview" className="contentBox">
        <h3 className="header">
          {isCapital ? t('capital') : t('colony')} &quot;{town.name}&quot;{' '}
          <a
            href={hashFor('renameCity')}
            title={t('rename_city')}
            onClick={nav(hashFor('renameCity'))}
          >
            {t('rename')}
          </a>
        </h3>
        <div className="content">
          <img
            className="citizen"
            src="/skin/characters/y100_citizen_faceright.gif"
            width={42}
            height={100}
            alt=""
          />
          <ul className="stats">
            <li className="space">
              <span className="textLabel">{t('housing_space')}: </span>
              <span className="value occupied">{num(townDerived.totalPeoples)}</span>/
              <span className="value total">{num(townDerived.maxPeoples)}</span>
            </li>
            <li className="growth growth_positive">
              <span className="textLabel">{t('growth')}: </span>
              {/* Growth is happiness/50 per hour, printed to two decimals with
                  no thousands separator (number_format($n, 2, '.', '')). */}
              <span className="value">
                {(happy / 50).toFixed(2)} {t('per_hour')}
              </span>
            </li>
            <li className="actions">
              {/* Hardcoded 3 in the legacy, whatever the town hall grants. */}
              <span className="textLabel">{t('points_of_action')}: </span>
              {num(town.actionPoints)}/3
            </li>
            <li className={`incomegold incomegold_${townDerived.saldo > 0 ? 'positive' : 'negative'}`}>
              <span className="textLabel">{t('net_gold')}: </span>
              <span className="value">{num(townDerived.saldo)}</span>
            </li>
            <li className="garrisonLimit">
              <span className="textLabel">{t('island_garrison_limit')}: </span>
              <span className="value occupied">{num(townDerived.garrisonLimit)}</span>
            </li>
            <li className="corruption">
              <span className="textLabel">{t('corruption')}: </span>
              <span className="value positive">
                <span title={t('current_corruption')}>
                  {num(townDerived.corruption * 100)}%
                </span>
              </span>
            </li>
            <li className={`happiness happiness_${happinessClass(happy)}`}>
              <span className="textLabel">{t('satisfaction')}: </span>
              {happinessName(happy)}
            </li>
          </ul>

          <div id="PopulationGraph">
            <h4>{t('population_and_production')}:</h4>
            <div className="citizens" style={{ left: '20px', width: `${freePx}px` }}>
              <span className="type">
                <span className="count">{Math.floor(town.peoples)}</span>
                <img src="/skin/characters/40h/citizen_r.gif" title={t('peoples')} alt={t('peoples')} />
              </span>
              <span className="production">
                <span className="textLabel">{t('produce')} </span>
                <img src="/skin/resources/icon_gold.gif" alt={t('gold')} />{' '}
                {townDerived.saldo > 0 ? '+' : ''}
                {Math.floor(townDerived.saldo)}
              </span>
            </div>
            <div
              className="woodworkers"
              style={{ left: `${freePx + 20}px`, width: `${workersPx}px` }}
            >
              <span className="type">
                <span className="count">{town.workers}</span>
                <img
                  src="/skin/characters/40h/woodworker_r.gif"
                  title={t('workers')}
                  alt={t('workers')}
                />
              </span>
              <span className="production">
                <span className="textLabel">{t('produce')} </span>
                <img src="/skin/resources/icon_wood.gif" alt={t('wood')} /> +
                {num(town.workers * (1 - townDerived.corruption) * derived.plus.wood)}
              </span>
            </div>
            <div
              className="specialworkers"
              style={{ left: `${freePx + workersPx + 20}px`, width: `${specialPx}px` }}
            >
              <span className="type">
                <span className="count">{town.tradegood}</span>
                <img
                  src="/skin/characters/40h/luxuryworker_r.gif"
                  title={t('workers')}
                  alt={t('workers')}
                />
              </span>
              <span className="production">
                <span className="textLabel">{t('produce')} </span>
                <img src={`/skin/resources/icon_${resourceIcon(island.tradeResource)}.gif`} alt="" />{' '}
                +
                {num(
                  town.tradegood *
                    (1 - townDerived.corruption) *
                    derived.plus[townDerived.tradeResource],
                )}
              </span>
            </div>
            <div
              className="scientists"
              style={{
                left: `${freePx + workersPx + specialPx + 20}px`,
                width: `${researchPx}px`,
              }}
            >
              <span className="type">
                <span className="count">{town.scientists}</span>
                <img
                  src="/skin/characters/40h/scientist_r.gif"
                  title={t('scientists')}
                  alt={t('scientists')}
                />
              </span>
              <span className="production">
                <span className="textLabel">{t('produce')} </span>
                <img src="/skin/resources/icon_research.gif" alt={t('research_points')} /> +
                {town.scientists}
              </span>
            </div>
            <div
              className="priests"
              style={{
                left: `${freePx + workersPx + specialPx + researchPx + 20}px`,
                width: `${templerPx}px`,
              }}
            >
              <span className="type">
                <span className="count">{town.templer}</span>
                <img
                  src="/skin/characters/40h/templer_r.gif"
                  title={t('priests')}
                  alt={t('priests')}
                />
              </span>
            </div>
          </div>

          <div id="notices">
            <h4>{t('notices')}:</h4>
            {townDerived.corruption > 0 ? (
              <div className="warning">
                <h5>{t('warning_corruption_title')}</h5>
                <p>{t('warning_corruption_desc')}</p>
              </div>
            ) : (
              <p>{t('no_warnings')}</p>
            )}
          </div>
        </div>
        <div className="footer" />
      </div>

      <div className="contentBox">
        <h3 className="header">{t('satisfaction')}</h3>
        <div className="content">
          <p>{t('satisfaction_desc')}</p>
          <div id="SatisfactionOverview">
            <div className="positives">
              <h4>{t('bonuses')}</h4>
              <div className="cat basic">
                <h5>{t('basic_bonuses')}</h5>
                <div className="base" style={{ left: '100px', width: `${basePx}px` }}>
                  <span className="value">+{plus.base}</span>
                  <img
                    src="/skin/icons/city_30x30.gif"
                    width={30}
                    height={30}
                    title={t('basic_bonus')}
                    alt={t('basic_bonus')}
                  />
                </div>
                <div
                  className="research1"
                  style={{ left: `${basePx + 100}px`, width: `${researchBonusPx}px` }}
                >
                  <span className="value">+{plus.research}</span>
                  <img
                    src="/skin/icons/researchbonus_30x30.gif"
                    width={30}
                    height={30}
                    title={t('through_research')}
                    alt={t('through_research')}
                  />
                </div>
                <div
                  className="capital"
                  style={{
                    left: `${basePx + researchBonusPx + 100}px`,
                    width: `${capitalPx}px`,
                  }}
                >
                  <span className="value">+{plus.capital}</span>
                  <img
                    src="/skin/layout/crown.gif"
                    width={20}
                    height={20}
                    title={t('capital_bonus')}
                    alt={t('capital_bonus')}
                  />
                </div>
              </div>

              <div className="cat wine">
                <h5>{t('wine')}</h5>
                {tavernLevel > 0 ? (
                  <>
                    <div className="tavern" style={{ left: '100px', width: `${tavernPx}px` }}>
                      <span className="value">+{tavernBonus}</span>
                      <img
                        src="/skin/buildings/tavern_30x30.gif"
                        width={30}
                        height={30}
                        title={t('level_tavern')}
                        alt={t('level_tavern')}
                      />
                    </div>
                    {/* Offset by 60, not by tavernPx: the legacy reuses
                        `$base_px` from the bonus bar above (townHall.php:236). */}
                    <div
                      className="serving"
                      style={{ left: `${tavernPx + 60 + 100}px`, width: `${servingPx}px` }}
                    >
                      <span className="value">+{servingBonus}</span>
                      <img
                        src="/skin/resources/icon_wine.gif"
                        width={30}
                        height={30}
                        title={t('preparation_wine')}
                        alt={t('preparation_wine')}
                      />
                    </div>
                  </>
                ) : (
                  <p>{t('no_tavern')}</p>
                )}
              </div>

              {/* The museum is never built: there is no culture model. */}
              <div className="cat culture">
                <h5>{t('culture')}</h5>
                <p>{t('no_museum')}</p>
              </div>

              {/* Priests. Not a legacy row -- the 2012 template has nowhere to
                  put one, because nothing there could ever make a priest. */}
              <div className="cat basic">
                <h5>{t('priests')}</h5>
                {town.templer > 0 ? (
                  <div className="base" style={{ left: '100px', width: `${priestsPx}px` }}>
                    <span className="value">+{plus.priests}</span>
                    <img
                      src="/skin/characters/40h/templer_r.gif"
                      width={20}
                      height={40}
                      title={t('priests')}
                      alt={t('priests')}
                    />
                  </div>
                ) : (
                  <p>{t('no_priests')}</p>
                )}
              </div>
            </div>

            <div className="negatives">
              <h4>{t('deductions')}</h4>
              <div className="cat overpopulation">
                <h5>{t('population')}:</h5>
                <div
                  className="bar"
                  style={{
                    left: '100px',
                    width: `${Math.floor(
                      (townDerived.totalPeoples / (townDerived.maxPeoples || 1)) * 400,
                    )}px`,
                  }}
                >
                  <span className="value">-{num(townDerived.totalPeoples)}</span>
                </div>
              </div>
            </div>

            <div className={`happiness happiness_${happinessClass(happy)}`}>
              <h4>{t('satisfaction_total')}:</h4>
              <div className="value">{num(happy)}</div>
              <div className="text">{happinessName(happy)}</div>
            </div>
          </div>
        </div>
        <div className="footer" />
      </div>
    </div>
  )
}
