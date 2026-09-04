/**
 * Renders the sidebox list `sideboxesFor()` produced.
 *
 * One component per legacy file in izariam/views/sidebox/, except that the
 * eight "<< back to X" boxes collapse into `BackToBox` and the four 0-byte
 * files are dropped by the router before they reach here.
 *
 * A box with no implementation yet renders nothing rather than a placeholder:
 * `#mainview` keeps its 251px gutter either way (ik_common_0.4.5.css:325-327),
 * so an empty gutter is what the legacy showed for the 0-byte files too.
 */

import { PEDIA, RESEARCH_BRANCH_SIZE } from '@izariam/gamedata'
import { islandNodeCost } from '@izariam/rules'
import { useState } from 'react'

import { buildingName, tradeResourceName } from '../../lib/buildings.js'
import { num, t } from '../../lib/i18n.js'
import { hashFor } from '../../lib/routes.js'
import type { ScreenContext } from '../../screens/context.js'
import { UpgradePanel } from '../building/UpgradePanel.js'
import { Countdown } from '../Countdown.js'
import { ProgressBar } from '../ProgressBar.js'
import { BackToBox } from './BackToBox.js'
import { ConstructionList } from './ConstructionList.js'
import { UnitConstructionList } from './UnitConstructionList.js'

interface Props {
  boxes: string[]
  ctx: ScreenContext
}

/** The eight back-links: header key, label key, sprite, destination. */
const BACK: Record<
  string,
  { header: string; label: string; image: string; href: string; sized?: boolean }
> = {
  backToCity: {
    header: 'back_town',
    label: 'back_town',
    image: '/skin/img/action_back.gif',
    href: hashFor('city'),
  },
  back_to_island: {
    header: 'back',
    label: 'back_island',
    image: '/skin/img/action_back.gif',
    href: hashFor('island'),
  },
  researchOverview: {
    header: 'building3_name',
    label: 'building3_name',
    image: '/skin/buildings/y100/academy.gif',
    href: hashFor('academy'),
  },
  renameCity: {
    header: 'building1_name',
    label: 'building1_name',
    image: '/skin/buildings/y100/townHall.gif',
    href: hashFor('townHall'),
  },
  takeOffer: {
    header: 'building12_name',
    label: 'back',
    image: '/skin/buildings/y100/branchOffice.gif',
    href: hashFor('branchOffice'),
    sized: false,
  },
  safehouseMissions: {
    header: 'building14_name',
    label: 'building14_name',
    image: '/skin/buildings/y100/safehouse.gif',
    href: hashFor('safehouse'),
  },
  safehouseReports: {
    header: 'building14_name',
    label: 'building14_name',
    image: '/skin/buildings/y100/safehouse.gif',
    href: hashFor('safehouse'),
  },
  cityMilitary: {
    header: 'army_in_city',
    label: 'back_town',
    image: '/skin/img/action_back.gif',
    href: hashFor('city'),
  },
  merchantNavy: {
    header: 'merchant_navy',
    label: 'back_town',
    image: '/skin/img/action_back.gif',
    href: hashFor('city'),
  },
  premium: {
    header: 'izariam_plus',
    label: 'back_town',
    image: '/skin/img/action_back.gif',
    href: hashFor('city'),
  },
  premiumDetails: {
    header: 'izariam_plus',
    label: 'back_town',
    image: '/skin/img/action_back.gif',
    href: hashFor('city'),
  },
  premiumPayment: {
    header: 'izariam_plus',
    label: 'back_town',
    image: '/skin/img/action_back.gif',
    href: hashFor('city'),
  },
  premiumTradeAdvisor: {
    header: 'constructions_review',
    label: 'mayor',
    image: '/skin/research/area_city.jpg',
    href: hashFor('tradeAdvisor'),
  },
  armyGarrisonEdit: {
    header: 'building5_name',
    label: 'building5_name',
    image: '/skin/buildings/y100/barracks.gif',
    href: hashFor('barracks'),
  },
  fleetGarrisonEdit: {
    header: 'building4_name',
    label: 'building4_name',
    image: '/skin/buildings/y100/shipyard.gif',
    href: hashFor('shipyard'),
  },
}

export function SideBoxes({ boxes, ctx }: Props) {
  return (
    <>
      {boxes.map((box) => (
        <SideBoxFor key={box} box={box} ctx={ctx} />
      ))}
    </>
  )
}

function SideBoxFor({ box, ctx }: { box: string; ctx: ScreenContext }) {
  const nav = (hash: string) => ctx.navigate(hash)

  const back = BACK[box]
  if (back) {
    return (
      <BackToBox
        header={t(back.header)}
        label={t(back.label)}
        image={back.image}
        href={back.href}
        sized={back.sized}
        onNavigate={nav}
      />
    )
  }

  switch (box) {
    // The upgrade panel, reached by 19 screens through the missing break.
    case 'update':
      return (
        <UpgradePanel
          page={ctx.route.page}
          position={ctx.route.params[0]}
          state={ctx.state}
          town={ctx.town}
          hasPremium={ctx.chrome.hasPremium}
          onNavigate={nav}
          onUpgrade={(position) => {
            void ctx.act('upgrade', { townId: ctx.town.id, slot: position })
          }}
        />
      )

    // sidebox/academy.php -- a picture, a blurb and one button.
    case 'academy':
      return (
        <div id="researchLibrary" className="dynamic">
          <h3 className="header">{t('library')}</h3>
          <div className="content">
            <img src="/skin/research/img_library.jpg" width={203} height={85} alt="" />
            <p>{t('library_info')}</p>
            <div className="centerButton">
              <a
                href={hashFor('researchOverview')}
                className="button"
                onClick={(e) => {
                  e.preventDefault()
                  nav(hashFor('researchOverview'))
                }}
              >
                {t('to_library')}
              </a>
            </div>
          </div>
          <div className="footer" />
        </div>
      )

    // sidebox/townHall.php -- finances, plus the abandon box on a colony.
    case 'townHall':
      return (
        <>
          <div className="dynamic" id="finances">
            <h3 className="header">{t('switch_finance_overview')}</h3>
            <div className="content">
              <p>{t('view_complete_finance')}</p>
              <a
                href={hashFor('finances')}
                className="button"
                onClick={(e) => {
                  e.preventDefault()
                  nav(hashFor('finances'))
                }}
              >
                {t('switch_finance_overview')}
              </a>
            </div>
            <div className="footer" />
          </div>
          {ctx.town.id !== ctx.state.user.capitalTownId && (
            <div className="dynamic" id="abandon">
              <h3 className="header">{t('abolish_colony')}</h3>
              <div className="content">
                <p>{t('abolish_text')}</p>
                <a
                  href={hashFor('abolishColony')}
                  className="button"
                  onClick={(e) => {
                    e.preventDefault()
                    nav(hashFor('abolishColony'))
                  }}
                >
                  {t('abolish_colony')}
                </a>
              </div>
              <div className="footer" />
            </div>
          )}
        </>
      )

    /**
     * sidebox/city.php -- three boxes, not one.
     *
     * The construction list is premium-only: without it the box is replaced by
     * an advert for premium. And the invite-friends box appears only while the
     * queue holds two entries or fewer, so it disappears as the town gets busy.
     */
    case 'city':
      return (
        <>
          <div id="information" className="dynamic" style={{ zIndex: 1 }}>
            <h3 className="header">
              {ctx.town.name} ({ctx.town.buildings.bySlot[0]?.level ?? 0})
            </h3>
            <div className="content">
              <ul className="cityinfo">
                <div className="centerButton">
                  <a
                    href={hashFor('cityMilitary')}
                    className="button"
                    onClick={(e) => {
                      e.preventDefault()
                      nav(hashFor('cityMilitary'))
                    }}
                  >
                    {t('army_in_city')}
                  </a>
                </div>
              </ul>
            </div>
            <div className="footer" />
          </div>

          {ctx.chrome.hasPremium ? (
            ctx.town.buildQueue.length > 0 && <ConstructionList ctx={ctx} />
          ) : (
            <div className="dynamic" id="reportInboxLeft">
              <h3 className="header">{t('buildings_construction_list')}</h3>
              <div className="content">
                <img width={203} height={85} src="/skin/research/area_economy.jpg" alt="" />
                <p>{t('premium_turn')}</p>
                <div className="centerButton">
                  <a
                    href={hashFor('premium')}
                    className="button"
                    onClick={(e) => {
                      e.preventDefault()
                      nav(hashFor('premium'))
                    }}
                  >
                    {t('izariam_plus')}
                  </a>
                </div>
              </div>
              <div className="footer" />
            </div>
          )}

          {ctx.town.buildQueue.length <= 2 && (
            <div className="dynamic" id="reportInboxLeft">
              <h3 className="header">{t('invite_friends')}</h3>
              <div className="content">
                <p>{t('invite_friends_desc')}</p>
                <div className="centerButton">
                  {/* game/friendListEdit has no controller; the button is
                      rendered because the box's layout depends on it. */}
                  <a href="#" className="button" onClick={(e) => e.preventDefault()}>
                    {t('invite_friends')}
                  </a>
                </div>
              </div>
              <div className="footer" />
            </div>
          )}
        </>
      )

    // sidebox/inviteFriends.php, the only box the options screen gets. Its
    // strings are hardcoded English in the legacy, with no language keys to
    // fall back on, so they are hardcoded here too.
    case 'inviteFriends':
      return (
        <div className="dynamic" id="reportInboxLeft">
          <h3 className="header">{t('invite_friends')}</h3>
          <div className="content">
            <img width={167} height={110} src="/skin/options/invitefriends.jpg" alt="" />
            <p>{t('invite_friends_text')}</p>
            <div className="centerButton">
              <a href="#" className="button" onClick={(e) => e.preventDefault()}>
                {t('invite_friends')}
              </a>
            </div>
          </div>
          <div className="footer" />
        </div>
      )

    // sidebox/resource.php and tradegood.php -- the island node's level, what
    // the next one costs, what has been donated so far, and a donation box.
    case 'resource':
    case 'tradegood':
      return <IslandNodeBox ctx={ctx} kind={box} />

    // sidebox/barracks.php and shipyard.php: a link to the garrison editor
    // and the unit queue. The queue itself is the screen's business, so this
    // is the link box; the header is deliberately empty in the legacy too.
    case 'barracks':
    case 'shipyard':
      return (
        <>
          <div className="dynamic" id="reportInboxLeft">
            <h3 className="header" />
            <div className="content">
              <div className="centerButton">
                <a
                  href={hashFor(box === 'barracks' ? 'armyGarrisonEdit' : 'fleetGarrisonEdit')}
                  className="button"
                  onClick={(e) => {
                    e.preventDefault()
                    nav(hashFor(box === 'barracks' ? 'armyGarrisonEdit' : 'fleetGarrisonEdit'))
                  }}
                >
                  {t('fire_units')}
                </a>
              </div>
            </div>
            <div className="footer" />
          </div>
          <UnitConstructionList ctx={ctx} kind={box === 'barracks' ? 'land' : 'naval'} />
        </>
      )

    /**
     * Six boxes that are the same shape: a banner, a paragraph and a button.
     * Five of them sell premium; the sixth points at the library.
     */
    case 'researchAdvisor':
      return (
        <>
          <div className="dynamic">
            <h3 className="header">{t('review')}</h3>
            <div className="content">
              <ul className="researchLeftMenu">
                <li className="scientists">
                  {t('scientists')}: {Math.floor(ctx.derived.scientists)}
                </li>
                <li className="points">
                  {t('research_points')}: {Math.floor(ctx.state.user.research.points)}
                </li>
                <li className="time">
                  {t('per_hour')}:{' '}
                  {Math.floor(ctx.derived.plusResearch * ctx.derived.scientists)}
                </li>
              </ul>
            </div>
            <div className="footer" />
          </div>
          <PromoBox
            id="viewResearchImperium"
            header={t('research_review')}
            image="/skin/premium/sideAd_premiumResearchAdvisor.jpg"
            text={t('research_review_text1')}
            label={t('look_now')}
            href={hashFor('premiumDetails')}
            onNavigate={nav}
          />
          <PromoBox
            id="researchLibrary"
            header={t('library')}
            image="/skin/research/img_library.jpg"
            text={t('library_info')}
            label={t('to_library')}
            href={hashFor('researchOverview')}
            onNavigate={nav}
          />
        </>
      )

    case 'tradeAdvisor':
      return ctx.chrome.hasPremium ? (
        <PromoBox
          id="viewCityImperium"
          header={t('constructions_review')}
          image="/skin/research/area_city.jpg"
          text={t('constructions_review_text2')}
          label={t('to_view')}
          href={hashFor('premiumTradeAdvisor')}
          onNavigate={nav}
        />
      ) : (
        <PromoBox
          id="viewCityImperium"
          header={t('constructions_review')}
          image="/skin/premium/sideAd_premiumTradeAdvisor.jpg"
          text={t('constructions_review_text1')}
          label={t('look_now')}
          href={hashFor('premiumDetails')}
          onNavigate={nav}
        />
      )

    case 'militaryOverview':
      return (
        <PromoBox
          id="viewMilitaryImperium"
          header={t('military_review')}
          image="/skin/premium/sideAd_premiumMilitaryAdvisor.jpg"
          text={t('military_review_text1')}
          label={t('look_now')}
          href={hashFor('premiumDetails')}
          onNavigate={nav}
        />
      )

    case 'highscore':
      return (
        <>
          {/* game/allyHighscore and main/pillory have no controller; both
              buttons are rendered and inert, as they were. */}
          <div id="highscoreswitch" className="dynamic">
            <h3 className="header">{t('top_ally')}</h3>
            <div className="content">
              <img width={203} height={85} src="/skin/layout/sieger_2.jpg" alt="" />
              <div className="centerButton">
                <a href="#" className="button" onClick={(e) => e.preventDefault()}>
                  {t('top_ally')}
                </a>
              </div>
            </div>
            <div className="footer" />
          </div>
          <div className="dynamic">
            <h3 className="header">{t('pillory')}</h3>
            <div className="content">
              <p>{t('pillory_text')}</p>
              <div className="centerButton">
                <a href="#" className="button" onClick={(e) => e.preventDefault()}>
                  {t('pillory')}
                </a>
              </div>
            </div>
            <div className="footer" />
          </div>
        </>
      )

    // sidebox/diplomacyAdvisor.php: a link to write a new message. The
    // recipient picker it advertises never existed, so the button opens the
    // compose screen with no addressee.
    case 'diplomacyAdvisor':
      return (
        <div className="dynamic" id="writeMessage">
          <h3 className="header">{t('create_message')}</h3>
          <div className="content">
            <div className="centerButton">
              <a href="#" className="button" onClick={(e) => e.preventDefault()}>
                {t('create_message')}
              </a>
            </div>
          </div>
          <div className="footer" />
        </div>
      )

    /**
     * The four encyclopedia-style index boxes: a list of topics with the
     * current one's children expanded. Their contents are the same topic table
     * the main pane renders from, so the list is generated rather than copied.
     */
    case 'pedia':
    case 'informations':
      return <TopicIndex ctx={ctx} book={box} />

    /**
     * sidebox/demolition.php -- the same upgrade panel the building screens
     * get, so the player can see what they are about to lose. The legacy
     * inlines a copy; here it is the shared component.
     */
    case 'demolition':
      return (
        <UpgradePanel
          page={ctx.route.page}
          position={ctx.route.params[0]}
          state={ctx.state}
          town={ctx.town}
          hasPremium={ctx.chrome.hasPremium}
          onNavigate={nav}
          onUpgrade={(position) => {
            void ctx.act('upgrade', { townId: ctx.town.id, slot: position })
          }}
        />
      )

    /**
     * The three detail-page indexes. Each lists everything of its kind and
     * links to the detail route; the legacy hand-writes all of them, which is
     * why researchDetail.php alone is 19 KB.
     */
    case 'buildingDetail':
      return (
        <IndexBox
          title={t('building_info')}
          items={Array.from({ length: 26 }, (_, i) => i + 1).map((type) => ({
            id: type,
            label: buildingName(type),
            href: hashFor('buildingDetail', type),
          }))}
          onNavigate={nav}
          current={ctx.route.params[0]}
        />
      )

    case 'wonderDetail':
      return (
        <IndexBox
          title={t('wonder_info')}
          items={Array.from({ length: 8 }, (_, i) => i + 1).map((id) => ({
            id,
            label: t(`wonder_${id}`),
            href: hashFor('wonderDetail', id),
          }))}
          onNavigate={nav}
          current={ctx.route.params[0]}
        />
      )

    case 'researchDetail': {
      const way = Math.min(4, Math.max(1, ctx.route.params[0] || 1))
      const size = RESEARCH_BRANCH_SIZE[way] ?? 0
      return (
        <IndexBox
          title={t('research_detail')}
          items={Array.from({ length: size }, (_, i) => i + 1).map((id) => ({
            id,
            label: t(`research${way}_${id}_name`),
            href: hashFor('researchDetail', way, id),
            done: (ctx.state.user.research.levels[`${way}_${id}`] ?? 0) > 0,
          }))}
          onNavigate={nav}
          current={ctx.route.params[1]}
        />
      )
    }

    default:
      return null
  }
}

/** A `.dynamic` box holding a list of links, one of them current. */
function IndexBox({
  title,
  items,
  current,
  onNavigate,
}: {
  title: string
  items: { id: number; label: string; href: string; done?: boolean }[]
  current: number
  onNavigate: (hash: string) => void
}) {
  return (
    <div className="dynamic" id="civilopedia_menu" style={{ marginBottom: '10px' }}>
      <h3 className="header">{title}</h3>
      <div className="main">
        <ul>
          {items.map((item) => (
            <li
              key={item.id}
              className={[item.id === current ? 'selected' : '', item.done ? 'explored' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <a
                title={`${t('learn_more')} ${item.label}...`}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  onNavigate(item.href)
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="footer" />
    </div>
  )
}

/** The encyclopedia index, built from the same topic table the page renders. */
function TopicIndex({ ctx, book }: { ctx: ScreenContext; book: 'pedia' | 'informations' }) {
  const topics = PEDIA[book]
  const numbers = Object.keys(topics)
    .map(Number)
    .sort((a, b) => a - b)

  const label = (n: number) => {
    const first = topics[String(n)]?.find((b) => b.kind === 'title' || b.kind === 'heading')
    return first && 'key' in first ? t(first.key) : `#${n}`
  }

  return (
    <IndexBox
      title={t(book === 'pedia' ? 'ikapedia' : 'full_info')}
      items={numbers.map((n) => ({ id: n, label: label(n), href: hashFor(book, n) }))}
      current={ctx.route.params[0]}
      onNavigate={(hash) => ctx.navigate(hash)}
    />
  )
}

/** The banner/paragraph/button box six sideboxes share. */
function PromoBox({
  id,
  header,
  image,
  text,
  label,
  href,
  onNavigate,
}: {
  id: string
  header: string
  image: string
  text: string
  label: string
  href: string
  onNavigate: (hash: string) => void
}) {
  return (
    <div className="dynamic" id={id}>
      <h3 className="header">{header}</h3>
      <div className="content">
        <img src={image} width={203} height={85} alt="" />
        <p>{text}</p>
        <div className="centerButton">
          <a
            href={href}
            className="button"
            onClick={(e) => {
              e.preventDefault()
              onNavigate(href)
            }}
          >
            {label}
          </a>
        </div>
      </div>
      <div className="footer" />
    </div>
  )
}

/**
 * The island node box. Two states, like the building panels: a progress bar
 * while an upgrade is running, otherwise the shortfall and a donation form.
 *
 * `max` is what the player could give right now -- the smaller of the
 * shortfall and their own wood -- and the "max" link fills the field with it.
 */
function IslandNodeBox({ ctx, kind }: { ctx: ScreenContext; kind: 'resource' | 'tradegood' }) {
  const isWood = kind === 'resource'
  const islandId = ctx.route.params[0] || ctx.town.islandId
  const island = ctx.state.islands[islandId] ?? ctx.island

  const level = isWood ? island.woodLevel : island.tradeLevel
  const donated = isWood ? island.woodDonated : island.tradeDonated
  const startedAt = isWood ? island.woodUpgradeStartedAt : island.tradeUpgradeStartedAt
  const cost = islandNodeCost(isWood ? 0 : 1, level)

  const shortfall = Math.max(0, cost.wood - donated)
  const max = Math.floor(Math.min(ctx.town.resources.wood, shortfall))

  const good = isWood ? 'wood' : tradeResourceName(island.tradeResource)
  const image = `/skin/resources/img_${good === 'crystal' ? 'glass' : good}.jpg`

  return (
    <div id="resUpgrade" className={startedAt ? 'dynamic upgrading' : 'dynamic'}>
      <h3 className="header">
        {isWood ? t('saw_mill') : t('mine')}
        <a
          className="help"
          href={hashFor('informations', 6)}
          title={t('help')}
          onClick={(e) => {
            e.preventDefault()
            ctx.navigate(hashFor('informations', 6))
          }}
        >
          <span className="textLabel">{t('need_help')}</span>
        </a>
      </h3>
      {startedAt ? (
        <div className="content">
          <img src={image} alt="" />
          <div className="isUpgrading">{t('is_upgrading')}</div>
          <div className="buildingLevel">
            <span className="textLabel">{t('level')}: </span>
            {level}
          </div>
          <div className="nextLevel">
            <span className="textLabel">{t('next_level')}: </span>
            {level + 1}
          </div>
          <ProgressBar
            id="upgradeProgress"
            startsAt={startedAt}
            endsAt={startedAt + cost.time}
            clockOffset={ctx.clockOffset}
          />
          <div className="time" id="upgradeCountDown">
            <Countdown
              endsAt={startedAt + cost.time}
              clockOffset={ctx.clockOffset}
              onFinish={ctx.refresh}
            />
          </div>
        </div>
      ) : (
        <div className="content">
          <img src={image} alt="" />
          <div className="buildingLevel">
            <span className="textLabel">{t('level')}: </span>
            {level}
          </div>
          <h4>{t('need_for_next')}:</h4>
          <ul className="resources">
            <li className="wood">
              <span className="textLabel">{t('wood')}: </span>
              {num(shortfall)}
            </li>
          </ul>
          <h4>{t('present')}:</h4>
          <div>
            <ul className="resources">
              <li className="wood">
                <span className="textLabel">{t('wood')}: </span>
                {num(donated)}
              </li>
            </ul>
          </div>
          <DonateForm ctx={ctx} kind={kind} islandId={islandId} max={max} />
        </div>
      )}
      <div className="footer" />
    </div>
  )
}

function DonateForm({
  ctx,
  kind,
  islandId,
  max,
}: {
  ctx: ScreenContext
  kind: 'resource' | 'tradegood'
  islandId: number
  max: number
}) {
  const [amount, setAmount] = useState(0)
  return (
    <form
      id="donateForm"
      onSubmit={(e) => {
        e.preventDefault()
        void ctx.act('resources', {
          townId: ctx.town.id,
          kind,
          islandId,
          donation: amount,
        })
      }}
    >
      {/* The skin styles the inner box through `.donate` -- block label,
          120px centred field (ik_common_0.4.5.css:2195-2210) -- while the
          legacy sidebox shipped the older `#donate` markup those rules
          never matched, leaving the form unstyled. */}
      <div className="donate">
        <label className="label" htmlFor="donateWood">
          {t('donate')}:
        </label>
        <input
          name="donation"
          id="donateWood"
          className="textfield"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
        />{' '}
        <a
          href="#setmax"
          title={t('donate_max')}
          onClick={(e) => {
            e.preventDefault()
            setAmount(max)
          }}
        >
          {t('max')}
        </a>
        <div className="centerButton">
          <input type="submit" className="button" value={t('donate_upgrade')} />
        </div>
      </div>
    </form>
  )
}
