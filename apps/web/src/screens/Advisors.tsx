/**
 * The four advisor screens and their tabs.
 *
 * izariam/views/view/{militaryAdvisorMilitaryMovements,
 * militaryAdvisorCombatReports,militaryAdvisorCombatReportsArchive,
 * diplomacyAdvisor,diplomacyAdvisorOutBox,tradeAdvisor,merchantNavy}.php.
 *
 * Two of the seven are hardcoded empty in the legacy and stay that way here,
 * because there is nothing behind them: the combat report list opens with
 * `$combat_reports = 0` and every branch below it is unreachable, and the
 * archive is the same file with a different heading. There is no combat model
 * anywhere in the codebase -- see packages/db/src/schema.ts, where the table
 * exists and nothing writes to it.
 *
 * The diplomacy tabs advertise `diplomacyAdvisorTreaty` and
 * `diplomacyAdvisorAlly`, neither of which has a controller or a `show_view`
 * case. Rendered as inert tabs, as they were.
 */

import type { MissionState } from '@izariam/rules'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useState } from 'react'

import { Countdown } from '../components/Countdown.js'
import { api, type MailMessage, type TownMessage } from '../lib/api.js'
import { buildingName } from '../lib/buildings.js'
import { formatTime } from '../lib/format.js'
import { num, t, tf } from '../lib/i18n.js'
import { hashFor, type Page } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

// ---------------------------------------------------------------------------
// Military
// ---------------------------------------------------------------------------

function MilitaryTabs({ ctx, current }: { ctx: ScreenContext; current: Page }) {
  const tabs: { page: Page; label: string; count?: number }[] = [
    {
      page: 'militaryAdvisorMilitaryMovements',
      label: 'troop_movements',
      count: ctx.state.missions.length,
    },
    { page: 'militaryAdvisorCombatReports', label: 'combat_reports', count: 0 },
    { page: 'militaryAdvisorCombatReportsArchive', label: 'archive' },
  ]
  return (
    <div className="yui-navset">
      <ul className="yui-nav">
        {tabs.map((tab) => (
          <li key={tab.page} className={tab.page === current ? 'selected' : undefined}>
            <a
              href={hashFor(tab.page)}
              title={t(tab.label)}
              onClick={(e) => {
                e.preventDefault()
                ctx.navigate(hashFor(tab.page))
              }}
            >
              <em>
                {t(tab.label)}
                {tab.count !== undefined ? ` (${tab.count})` : ''}
              </em>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * militaryAdvisorMilitaryMovements.php -- every fleet in flight.
 *
 * The row filter is the legacy's: your own missions always, plus incoming
 * foreign ones that have not yet turned for home. A foreign fleet on its way
 * back disappears from the list even though it is still carrying your goods.
 *
 * The countdown runs off `arrivesAt`, which the engine maintains as "when the
 * fleet next makes port" through both the outbound and the return leg, so one
 * Countdown serves every phase. When it fires, the state is refetched and the
 * tick resolves whatever landed.
 */
export const MilitaryMovementsScreen: Screen = ({ ctx, sideboxes }) => {
  const mine = ctx.state.missions.filter(
    (m) => m.userId === ctx.state.user.id || m.returnStartedAt == null,
  )

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('generals')}</h1>
          <p>{t('troop_movements')}</p>
        </div>
        <MilitaryTabs ctx={ctx} current="militaryAdvisorMilitaryMovements" />
        <div id="combatsInProgress" className="contentBox">
          <h3 className="header">{t('current_battles')}</h3>
          <div className="content">
            <ul>
              {/* No combat model exists -- the legacy's list was an empty
                  placeholder too (militaryAdvisorMilitaryMovements.php:25). */}
              <li />
            </ul>
          </div>
          <div className="footer" />
        </div>
        <div id="fleetMovements" className="contentBox">
          <h3 className="header">
            <span className="textLabel">
              {t('fleet')} / {t('troop_movements')}
            </span>
          </h3>
          <div className="content">
            <table width="100%" cellPadding={0} cellSpacing={0} className="locationEvents">
              <tbody>
                <tr style={{ fontWeight: 'bold', backgroundColor: '#faeac6' }}>
                  <td style={{ width: '35px', padding: 0 }} />
                  <td style={{ width: '50px' }}>{t('arrival_time')}</td>
                  <td style={{ width: '36px' }}>
                    <img
                      src="/skin/premium/premium_jet_s.gif"
                      width={36}
                      height={12}
                      title={t('speed')}
                      alt={t('speed')}
                    />
                  </td>
                  <td style={{ width: '150px' }}>{t('units')}</td>
                  <td>{t('origin')}</td>
                  <td colSpan={3} style={{ width: '80px', textAlign: 'center' }}>
                    {t('mission')}
                  </td>
                  <td>{t('target')}</td>
                  <td style={{ width: '42px' }}>{t('action')}</td>
                </tr>
                {mine.map((m, i) => (
                  <MissionRow key={m.id} ctx={ctx} mission={m} zebra={i % 2 === 1} />
                ))}
              </tbody>
            </table>
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
        <OccupiedBox titleKey="occupied_cities" emptyKey="not_occupied_cities" />
        <OccupiedBox titleKey="occupied_ports" emptyKey="not_occupied_ports" />
      </div>
    </>
  )
}

/** Resource -> icon file for the cargo tooltip. Crystal's is called glass. */
const TOOLTIP_ICON: Record<string, string> = {
  wood: 'wood',
  wine: 'wine',
  marble: 'marble',
  crystal: 'glass',
  sulfur: 'sulfur',
}

/**
 * One fleet row, shaped like militaryAdvisorMilitaryMovements.php:53-159 --
 * time icon, ticking countdown, ships with the hover manifest, the two towns,
 * the direction arrows and the mission plate between them, and the abort
 * button for a fleet of your own that has not turned for home.
 */
function MissionRow({
  ctx,
  mission,
  zebra,
}: {
  ctx: ScreenContext
  mission: MissionState
  zebra: boolean
}) {
  const [manifest, setManifest] = useState(false)
  const own = mission.userId === ctx.state.user.id
  const from = ctx.state.towns.find((x) => x.id === mission.fromTownId)
  const to = ctx.state.towns.find((x) => x.id === mission.toTownId)
  const returning = mission.returnStartedAt != null
  const sailing = mission.departedAt != null

  const classes = [own ? 'own' : 'hostile', zebra ? 'alt' : null].filter(Boolean).join(' ')
  const townLink = (town: typeof from) =>
    town ? (
      <>
        <a
          href={hashFor('island', town.islandId)}
          onClick={(e) => {
            e.preventDefault()
            ctx.navigate(hashFor('island', town.islandId))
          }}
        >
          {town.name}
        </a>{' '}
        ({ctx.state.user.login})
      </>
    ) : (
      '-'
    )

  return (
    <tr className={classes}>
      <td>
        <img src="/skin/resources/icon_time.gif" alt="" />
      </td>
      <td id={`fleetRow${mission.id}`} title={t('arrival_time')}>
        {mission.arrivesAt != null ? (
          <Countdown
            endsAt={mission.arrivesAt}
            clockOffset={ctx.clockOffset}
            onFinish={ctx.refresh}
          />
        ) : !sailing ? (
          t('shipping')
        ) : (
          ''
        )}
      </td>
      <td
        title={t('quantity')}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setManifest(true)}
        onMouseLeave={() => setManifest(false)}
      >
        {mission.transports} {t('ships')}
        <div className="tooltip2" style={{ display: manifest ? 'block' : 'none', zIndex: 2000 }}>
          <h5>
            {t('fleet')} / {t('military_units')} / {t('shipment')}
          </h5>
          <div className="unitBox" title={t('cargo_ship')}>
            <div className="icon">
              <img src="/skin/characters/fleet/40x40/ship_transport_r_40x40.gif" alt="" />
            </div>
            <div className="count">{num(mission.transports)}</div>
          </div>
          {(['wood', 'wine', 'marble', 'crystal', 'sulfur'] as const)
            .filter((r) => mission.cargo[r] > 0)
            .map((r) => (
              <div key={r} className="unitBox" title={t(r)}>
                <div className="iconSmall">
                  <img src={`/skin/resources/icon_${TOOLTIP_ICON[r]}.gif`} alt="" />
                </div>
                <div className="count">{num(mission.cargo[r])}</div>
              </div>
            ))}
          {mission.cargo.peoples > 0 && (
            <div className="unitBox" title={t('peoples')}>
              <div className="iconSmall">
                <img src="/skin/resources/icon_citizen.gif" alt="" />
              </div>
              <div className="count">{num(mission.cargo.peoples)}</div>
            </div>
          )}
        </div>
      </td>
      <td title={t('start')}>{townLink(from)}</td>
      <td style={{ width: 12, paddingLeft: 0, paddingRight: 0 }}>
        {returning && (
          <img style={{ paddingBottom: 5 }} src="/skin/interface/arrow_left_green.gif" alt="" />
        )}
      </td>
      <td
        style={{ textAlign: 'center', width: 35 }}
        title={`${t(`mission_${mission.kind}`)} ${
          !returning ? (sailing ? `(${t('on_road')})` : `(${t('shipping')})`) : `(${t('return')})`
        }`}
      >
        {mission.kind === 'colonise' || mission.kind === 'transport' ? (
          <img src="/skin/interface/mission_transport.gif" alt="" />
        ) : (
          <img src="/skin/interface/mission_trade.gif" alt="" />
        )}
      </td>
      <td style={{ width: 12, paddingLeft: 0, paddingRight: 0 }}>
        {!returning && sailing && (
          <img style={{ paddingBottom: 5 }} src="/skin/interface/arrow_right_green.gif" alt="" />
        )}
      </td>
      <td title={t('target')}>{townLink(to)}</td>
      <td title={t('actions')} style={{ textAlign: 'center' }}>
        {own && !returning ? (
          <a
            href="#"
            title={`${t('back')}!`}
            onClick={(e) => {
              e.preventDefault()
              void ctx.act('abortFleet', { missionId: mission.id })
            }}
          >
            <img src="/skin/interface/btn_abort.gif" alt={t('back')} />
          </a>
        ) : (
          '-'
        )}
      </td>
    </tr>
  )
}

/** The occupied-cities / occupied-ports tables, both empty: nothing in the
 *  engine occupies anything yet, and the legacy shipped the same empties. */
function OccupiedBox({ titleKey, emptyKey }: { titleKey: string; emptyKey: string }) {
  return (
    <div className="contentBox01h">
      <h3 className="header">
        <span className="textLabel">{t(titleKey)}</span>
      </h3>
      <div className="content">
        <table width="100%" cellPadding={0} cellSpacing={0} className="table01">
          <thead>
            <tr>
              <th className="crown" />
              <th>{t('town')}</th>
              <th>{t('level')}</th>
              <th>{t('island')}</th>
              <th>{t('resource')}</th>
              <th>{t('action')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6}>{t(emptyKey)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="footer" />
    </div>
  )
}

/** Both combat-report screens: hardcoded empty in the legacy. */
function CombatReports({ ctx, sideboxes, page }: { ctx: ScreenContext; sideboxes: React.ReactNode; page: Page }) {
  const archive = page === 'militaryAdvisorCombatReportsArchive'
  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('generals')}</h1>
          <p>{t('advisor_combat_reports')}</p>
        </div>
        <MilitaryTabs ctx={ctx} current={page} />
        <div id="troopsOverview">
          <div className="contentBox01h">
            <h3 className="header">
              <span className="textLabel">{t(archive ? 'archive' : 'combat_reports')}</span>
            </h3>
            <div className="content">
              {/* `$combat_reports = 0` in the original, unconditionally. */}
              <p>{t('no_reports')}</p>
            </div>
            <div className="footer" />
          </div>
        </div>
      </div>
    </>
  )
}

export const CombatReportsScreen: Screen = (props) => (
  <CombatReports {...props} page="militaryAdvisorCombatReports" />
)
export const CombatReportsArchiveScreen: Screen = (props) => (
  <CombatReports {...props} page="militaryAdvisorCombatReportsArchive" />
)

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

function DiplomacyTabs({ ctx, outbox }: { ctx: ScreenContext; outbox: boolean }) {
  const mail = useQuery({ queryKey: ['mail', 'inbox'], queryFn: () => api.messages('inbox') })
  const sent = useQuery({ queryKey: ['mail', 'outbox'], queryFn: () => api.messages('outbox') })

  return (
    <div className="diplomacyAdvisorTabs">
      <table cellPadding={0} cellSpacing={0} id="tabz">
        <tbody>
          <tr>
            <td className={outbox ? undefined : 'selected'}>
              <a
                href={hashFor('diplomacyAdvisor')}
                title={t('inbox')}
                onClick={(e) => {
                  e.preventDefault()
                  ctx.navigate(hashFor('diplomacyAdvisor'))
                }}
              >
                <em>
                  {t('inbox')} ({mail.data?.messages.length ?? 0})
                </em>
              </a>
            </td>
            <td className={outbox ? 'selected' : undefined}>
              <a
                href={hashFor('diplomacyAdvisorOutBox')}
                title={t('outbox')}
                onClick={(e) => {
                  e.preventDefault()
                  ctx.navigate(hashFor('diplomacyAdvisorOutBox'))
                }}
              >
                <em>
                  {t('outbox')} ({sent.data?.messages.length ?? 0})
                </em>
              </a>
            </td>
            {/* Neither of these has a controller. */}
            <td>
              <a href="#" title={t('treaty_overview')} onClick={(e) => e.preventDefault()}>
                <em>{t('treaty')}</em>
              </a>
            </td>
            <td>
              <a href="#" title={t('ally_info')} onClick={(e) => e.preventDefault()}>
                <em>{t('ally')}</em>
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** `date("d.m.Y G:i")` -- the mail table's format, leading zeros on the day. */
function mailDate(epoch: number): string {
  const d = new Date(epoch * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${d.getHours()}:${pad(d.getMinutes())}`
}

/**
 * One box of the diplomacy advisor (diplomacyAdvisor.php / OutBox.php).
 *
 * The table is the legacy's: a checkbox, a disclosure arrow, the other party's
 * login, the subject, the sender's capital on the inbox, and the date. A row
 * click expands the message in a hidden `tr.text` below it -- and an unread row
 * is marked read by the same click, which is what the legacy's `markAsRead`
 * did from the row's onClick.
 */
function Mailbox({ ctx, box }: { ctx: ScreenContext; box: 'inbox' | 'outbox' }) {
  const queryClient = useQueryClient()
  const mail = useQuery({ queryKey: ['mail', box], queryFn: () => api.messages(box) })
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [checked, setChecked] = useState<Set<number>>(new Set())

  // ctx.act invalidates the state graph, not this list; reading and deleting
  // would otherwise leave the rows -- and their unread bold -- a request stale.
  const act = (path: string, body: unknown) =>
    ctx.act(path, body).then(() =>
      queryClient.invalidateQueries({ queryKey: ['mail'] }),
    )

  const messages = mail.data?.messages ?? []
  const toggle = (m: MailMessage) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(m.id)) next.delete(m.id)
      else next.add(m.id)
      return next
    })
    // The legacy opened an unread mail and marked it read in the same click
    // (diplomacyAdvisor.php:105).
    if (box === 'inbox' && m.checkedTo === 0) void act('readUserMessage', { id: m.id })
  }

  const markAll = (mode: 'all' | 'read' | 'unread' | 'none') => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const m of messages) {
        const on =
          mode === 'all' ||
          (mode === 'read' && m.checkedTo > 0) ||
          (mode === 'unread' && box === 'inbox' && m.checkedTo === 0)
        if (on) next.add(m.id)
        else next.delete(m.id)
      }
      return next
    })
  }

  const deleteChecked = () => {
    for (const id of checked) void act('deleteUserMessages', { id })
    setChecked(new Set())
  }

  return (
    <div id="messages">
      <div className="contentBox01">
        <h3 className="header">
          <span className="textLabel">{t('messages')}</span>
        </h3>
        <div className="content">
          <form
            name="deleteMessages"
            id="deleteMessages"
            onSubmit={(e) => {
              e.preventDefault()
              deleteChecked()
            }}
          >
            {messages.length > 0 ? (
              <table
                cellPadding={0}
                cellSpacing={0}
                className="table01"
                id="messages"
                style={{ width: '100%', margin: 0, border: 'none' }}
              >
                <tbody>
                  <tr>
                    <th>{t('action')}</th>
                    <th />
                    <th>{box === 'inbox' ? t('sender') : t('addressee')}</th>
                    <th>{t('subject')}</th>
                    {box === 'inbox' && <th>{t('town')}</th>}
                    <th>{t('date')}</th>
                  </tr>
                  {messages.map((m) => {
                    const expanded = open.has(m.id)
                    const unread = box === 'inbox' && m.checkedTo === 0
                    return (
                      <Fragment key={m.id}>
                        <tr
                          id={`message${m.id}`}
                          title={t('expand_hide')}
                          className={`entry ${unread ? 'new' : ''}`}
                          style={{ cursor: 'pointer' }}
                          onMouseOver={(e) => (e.currentTarget.bgColor = '#ECD5AC')}
                          onMouseOut={(e) => (e.currentTarget.bgColor = '#FDF7DD')}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked.has(m.id)}
                              onChange={() =>
                                setChecked((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(m.id)) next.delete(m.id)
                                  else next.add(m.id)
                                  return next
                                })
                              }
                            />
                          </td>
                          <td onClick={() => toggle(m)}>
                            <img
                              className={expanded ? 'close' : 'open'}
                              id={`button${m.id}`}
                              alt=""
                              src={
                                expanded
                                  ? '/skin/layout/up-arrow.gif'
                                  : '/skin/layout/down-arrow.gif'
                              }
                            />
                          </td>
                          <td onClick={() => toggle(m)}>
                            <a href="#" onClick={(e) => e.preventDefault()}>
                              {box === 'inbox' ? m.fromLogin : m.toLogin}
                            </a>
                          </td>
                          <td className="subject" onClick={() => toggle(m)}>
                            {t('message')}
                          </td>
                          {box === 'inbox' && (
                            <td title={t('to_city_sender')}>
                              {m.fromTown?.name ? (
                                <a
                                  href={hashFor('island', m.fromTown.islandId ?? 0)}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    ctx.navigate(hashFor('island', m.fromTown!.islandId ?? 0))
                                  }}
                                >
                                  {m.fromTown.name} [{m.fromTown.x}:{m.fromTown.y}]
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                          )}
                          <td onClick={() => toggle(m)}>{mailDate(m.date)}</td>
                        </tr>
                        {expanded && (
                          <tr className="text">
                            <td colSpan={box === 'inbox' ? 6 : 5} className="msgText">
                              <div style={{ overflow: 'auto', width: '100%' }}>{m.text}</div>
                              {box === 'inbox' && (
                                <span style={{ float: 'left', padding: 5, marginLeft: 5 }}>
                                  <a
                                    className="button"
                                    href={hashFor(
                                      'sendIKMessage',
                                      m.from,
                                      encodeURIComponent(m.fromLogin),
                                    )}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      ctx.navigate(
                                        hashFor(
                                          'sendIKMessage',
                                          m.from,
                                          encodeURIComponent(m.fromLogin),
                                        ),
                                      )
                                    }}
                                  >
                                    {t('send_message')}
                                  </a>{' '}
                                  <a
                                    className="button"
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      void act('deleteUserMessages', { id: m.id })
                                    }}
                                  >
                                    {t('delete')}
                                  </a>
                                </span>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  <tr>
                    <td colSpan={box === 'inbox' ? 6 : 5} style={{ textAlign: 'left' }}>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          markAll('all')
                        }}
                      >
                        {t('all')}
                      </a>{' '}
                      |{' '}
                      {box === 'inbox' && (
                        <>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              markAll('read')
                            }}
                          >
                            {t('read')}
                          </a>{' '}
                          |{' '}
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              markAll('unread')
                            }}
                          >
                            {t('unread')}
                          </a>{' '}
                          |{' '}
                        </>
                      )}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          markAll('none')
                        }}
                      >
                        {t('none')}
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td className="selection" colSpan={box === 'inbox' ? 6 : 5} style={{ textAlign: 'left' }}>
                      <input type="submit" value={t('delete')} className="button" />
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table
                cellPadding={0}
                cellSpacing={0}
                className="table01"
                id="messages"
                style={{ width: '100%', margin: 0, border: 'none' }}
              >
                <tbody>
                  <tr>
                    <th colSpan={box === 'inbox' ? 6 : 5}>
                      <p>{t('no_messages')}</p>
                    </th>
                  </tr>
                </tbody>
              </table>
            )}
          </form>
          {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
        </div>
        <div className="footer" />
      </div>
      {/* diplomacyAdvisorArchive has no screen here; the buttons are inert,
          exactly as the legacy's dead links were dead. */}
      <div className="dynamic" id="viewDiplomacyImperium" style={{ zIndex: 1 }}>
        <h3 className="header">{t('message_archive')}</h3>
        <div className="content">
          <div className="centerButton">
            <div>
              <a className="button" href="#" onClick={(e) => e.preventDefault()}>
                <b>{t('inbox')}</b>
              </a>{' '}
              <a className="button" href="#" onClick={(e) => e.preventDefault()}>
                <b>{t('outbox')}</b>
              </a>
            </div>
          </div>
        </div>
        <div className="footer" />
      </div>
    </div>
  )
}

export const DiplomacyAdvisorScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div id="diplomacyDescription" className="buildingDescription">
        <h1>{t('diplomatic_advisor')}</h1>
        <p />
      </div>
      <DiplomacyTabs ctx={ctx} outbox={false} />
      <div id="tab1">
        <Mailbox ctx={ctx} box="inbox" />
      </div>
    </div>
  </>
)

export const DiplomacyOutboxScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div id="diplomacyDescription" className="buildingDescription">
        <h1>{t('diplomatic_advisor')}</h1>
        <p />
      </div>
      <DiplomacyTabs ctx={ctx} outbox />
      <div id="tab2">
        <Mailbox ctx={ctx} box="outbox" />
      </div>
    </div>
  </>
)

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

/**
 * The town advisor's news list, izariam/views/view/tradeAdvisor.php.
 *
 * The legacy stored each notice as a rendered HTML sentence; the port stores
 * the event and its numbers (`kind` + `params`) so the sentence can be built in
 * the chosen language. One entry here per `kind` the rules engine emits.
 */
function messageText(m: TownMessage): string {
  const p = m.params as Record<string, number | string | undefined>
  const building = () => buildingName(Number(p.type ?? 0))
  switch (m.kind) {
    case 'building_completed':
      return tf('msg_building_completed', building())
    case 'building_upgraded':
      return tf('msg_building_upgraded', building(), String(p.level ?? ''))
    case 'trade_route_started':
      return t('msg_trade_route_started')
    case 'mission_colony_founded':
      return t('msg_mission_colony_founded')
    case 'mission_transport_received':
      return t('msg_mission_transport_received')
    case 'mission_transport_delivered':
      return t('msg_mission_transport_delivered')
    case 'mission_buy_loading':
      return t('msg_mission_buy_loading')
    case 'mission_buy_loading_incoming':
      return t('msg_mission_buy_loading_incoming')
    case 'mission_buy_empty':
      return t('msg_mission_buy_empty')
    case 'mission_sell_unloaded':
      return t('msg_mission_sell_unloaded')
    case 'mission_sell_unloaded_incoming':
      return t('msg_mission_sell_unloaded_incoming')
    case 'mission_fleet_returned':
      return t('msg_mission_fleet_returned')
    case 'island_wonder_upgraded':
      return tf('island_wonder_upgraded', String(p.level ?? ''))
    default:
      return m.kind
  }
}

/**
 * tradeAdvisor.php -- the town news list, and every town's stock and income.
 *
 * Opening the page marks the list read, which is what the legacy did as a side
 * effect of rendering the template (tradeAdvisor.php:86-90). Without it the
 * advisor portrait lit up on the first completed building and never went out:
 * nothing in the port wrote `town_messages.read_at` at all.
 */
export const TradeAdvisorScreen: Screen = ({ ctx, sideboxes }) => {
  const queryClient = useQueryClient()
  const news = useQuery({ queryKey: ['town-messages'], queryFn: api.townMessages })
  const messages = news.data?.messages ?? []
  const unread = messages.filter((m) => !m.read).length

  useEffect(() => {
    if (unread === 0) return
    void api.readTownMessages().then(() => {
      // The lamp is driven by chrome.newTownMessages, which rides on /state.
      void queryClient.invalidateQueries({ queryKey: ['state'] })
      void queryClient.invalidateQueries({ queryKey: ['town-messages'] })
    })
  }, [unread, queryClient])

  return (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('mayor')}</h1>
        <p>{t('trade_advisor_title')}</p>
      </div>

      {/* tradeAdvisor.php:24-33 -- the two tabs the advisor is split across. */}
      <div className="militaryAdvisorTabs">
        <table cellPadding={0} cellSpacing={0} id="tabz">
          <tbody>
            <tr>
              <td className="selected">
                <a href={hashFor('tradeAdvisor')} onClick={(e) => e.preventDefault()}>
                  <em>{t('town_news')}</em>
                </a>
              </td>
              <td>
                <a
                  href={hashFor('tradeAdvisorTradeRoute')}
                  onClick={(e) => {
                    e.preventDefault()
                    ctx.navigate(hashFor('tradeAdvisorTradeRoute'))
                  }}
                >
                  <em>{t('trade_routes')}</em>
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="contentBox01h">
        <h3 className="header">
          <span className="textLabel">
            {t('current_events')} ({messages.length})
          </span>
        </h3>
        <div className="content">
          <table cellPadding={0} cellSpacing={0} className="table01">
            <tbody>
              <tr>
                <th />
                <th>{t('city')}</th>
                <th>{t('date')}</th>
                <th>{t('subject')}</th>
              </tr>
              {messages.map((m, i) => (
                <tr key={m.id} className={i % 2 === 1 ? 'alt' : undefined}>
                  {/* `wichtig` is the legacy's unread marker (:52). */}
                  <td className={m.read ? 'empty' : 'wichtig'} />
                  <td className="city">
                    {ctx.state.towns.find((x) => x.id === m.townId)?.name ?? ''}
                  </td>
                  <td className="date">{new Date(m.createdAt * 1000).toLocaleString()}</td>
                  <td className="subject">{messageText(m)}</td>
                </tr>
              ))}
              {messages.length === 0 && (
                <tr>
                  <td colSpan={4}>{t('no_messages')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="footer" />
      </div>

      <div className="contentBox01h">
        <h3 className="header">
          <span className="textLabel">{t('cities')}</span>
        </h3>
        <div className="content">
          <table cellPadding={0} cellSpacing={0} className="table01">
            <tbody>
              <tr>
                <th>{t('city')}</th>
                <th>{t('peoples')}</th>
                <th>{t('wood')}</th>
                <th>{t('wine')}</th>
                <th>{t('marble')}</th>
                <th>{t('crystal')}</th>
                <th>{t('sulfur')}</th>
                <th>{t('net_gold')}</th>
              </tr>
              {ctx.state.towns.map((town, i) => {
                const d = ctx.derived.towns[town.id]
                return (
                  <tr key={town.id} className={i % 2 === 1 ? 'alt' : undefined}>
                    <td>{town.name}</td>
                    <td>{num(d?.totalPeoples ?? town.peoples)}</td>
                    <td>{num(town.resources.wood)}</td>
                    <td>{num(town.resources.wine)}</td>
                    <td>{num(town.resources.marble)}</td>
                    <td>{num(town.resources.crystal)}</td>
                    <td>{num(town.resources.sulfur)}</td>
                    <td className={(d?.saldo ?? 0) < 0 ? 'negative' : undefined}>
                      {num(d?.saldo ?? 0)}
                    </td>
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

/** merchantNavy.php -- the cargo fleet: how many ships, and where they are. */
export const MerchantNavyScreen: Screen = ({ ctx, sideboxes }) => {
  const inFlight = ctx.state.missions
    .filter((m) => m.userId === ctx.state.user.id)
    .reduce((n, m) => n + m.transports, 0)

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('merchant_navy')}</h1>
        </div>
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('merchant_navy')}</span>
          </h3>
          <div className="content">
            <ul className="resources">
              <li>
                <span className="textLabel">{t('available')}: </span>
                {num(ctx.state.user.transports)}
              </li>
              <li>
                <span className="textLabel">{t('shipping')}: </span>
                {num(inFlight)}
              </li>
              <li>
                <span className="textLabel">{t('total')}: </span>
                {num(ctx.state.user.transports + inFlight)}
              </li>
            </ul>
            <div className="centerButton">
              <a
                className="button"
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  void ctx.act('transporter', { townId: ctx.town.id })
                }}
              >
                {t('buy_transporter')}
              </a>
            </div>
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}
