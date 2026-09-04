/**
 * The temple: priests, faith, and the island's miracle.
 *
 * There is no legacy screen to be faithful to. The 2012 game lets you build a
 * temple (building 26), stores `towns.templer`, prints a "Priests" bar in the
 * town hall that is always zero -- and has no page: `view_model.php` has no
 * `temple` case, so clicking the finished building took you to the
 * empty-ground construction menu, as if it were never built.
 *
 * So the markup borrows the academy's, which is the closest legacy screen: the
 * same `assign_workers` box, the same slider, the same submit. The miracle
 * panel below it is a plain `contentBox01h`, styled by rules that already
 * exist.
 */

import {
  MIRACLES,
  cooldownFor,
  effectiveMiracleLevel,
  miracleLevelForFaith,
  miracleWindow,
  priestsByLevel,
  templesForWonder,
  HAPPINESS_PER_PRIEST,
} from '@izariam/rules'
import { useState } from 'react'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { Countdown } from '../components/Countdown.js'
import { Slider } from '../components/Slider.js'
import { formatTime } from '../lib/format.js'
import { num, t, tf } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

function percent(value: number): string {
  return `${Math.floor(value * 100)}%`
}

export const TempleScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const { town, townDerived } = ctx
  const level = town.buildings.bySlot[position]?.level ?? 0

  const available = town.peoples + town.templer
  const max = Math.floor(Math.min(priestsByLevel(level), available))
  const [assigned, setAssigned] = useState(Math.floor(town.templer))

  const projectedCitizens = Math.floor(available - assigned)
  // The same arithmetic derive() runs, so the number moves with the slider
  // before anything is sent.
  const projectedFaith =
    townDerived.maxPeoples > 0 ? Math.min(1, (assigned * 5) / townDerived.maxPeoples) : 0
  const projectedHappiness =
    townDerived.happiness + HAPPINESS_PER_PRIEST * (assigned - Math.floor(town.templer))

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

        {/*
          `setWorkers`, not a name of its own: the whole slider layout --
          the two figures, the min/max buttons, the track and the number field
          -- is styled by `#setWorkers ...` rules in ik_common (:2236-2300),
          which are the only ones not scoped to a body id. The academy's
          equivalents live in `ik_academy_*.css` behind `#academy`, and a page
          the legacy never had has no stylesheet of its own to load.
        */}
        <form
          id="setWorkers"
          onSubmit={(e) => {
            e.preventDefault()
            void ctx.act('workers', {
              townId: town.id,
              screen: 'temple',
              slot: position,
              priests: assigned,
            })
          }}
        >
          <div id="setWorkersBox" className="contentBox">
            <h3 className="header">
              <span className="textLabel">{t('assign_workers')}</span>
            </h3>
            <div className="content">
              <ul>
                <li className="citizens">
                  <span className="textLabel">{t('peoples')}: </span>
                  <span className="value" id="valueCitizens">
                    {num(projectedCitizens)}
                  </span>
                </li>
                <li className="workers">
                  {/* `#resource #setWorkers .workers` paints the woodcutter, and
                      that rule is scoped to the island-node page, so the priest
                      is an image rather than a background here. */}
                  <img
                    src="/skin/characters/40h/templer_r.gif"
                    alt=""
                    style={{ position: 'absolute', top: '16px', left: '30px' }}
                  />
                  <span className="textLabel">{t('priests')}: </span>
                  <span className="value" id="valueWorkers">
                    {num(assigned)}
                  </span>
                </li>
                <li className="gain">
                  <span className="textLabel">{t('faith')}: </span>
                  <div className="gainPerHour">
                    <span id="valueResource">{percent(projectedFaith)}</span>{' '}
                    <span className="timeUnit">
                      {t('priests')} {num(assigned)}/{num(priestsByLevel(level))}
                    </span>
                  </div>
                </li>
                <li className="costs">
                  <span className="textLabel">{t('satisfaction')}: </span>
                  <span
                    id="valueResearchCosts"
                    className={projectedHappiness < 0 ? 'negative' : undefined}
                  >
                    {Math.floor(projectedHappiness)}
                  </span>
                </li>
              </ul>

              <Slider value={assigned} max={max} onChange={setAssigned} />

              <a
                className="setMin"
                href="#reset"
                title={t('min')}
                onClick={(e) => {
                  e.preventDefault()
                  setAssigned(0)
                }}
              >
                <span className="textLabel">{t('min')}</span>
              </a>
              <a
                className="setMax"
                href="#max"
                title={t('max')}
                onClick={(e) => {
                  e.preventDefault()
                  setAssigned(max)
                }}
              >
                <span className="textLabel">{t('max')}</span>
              </a>
              <input
                name="p"
                id="inputWorkers"
                className="textfield"
                maxLength={4}
                autoComplete="off"
                value={assigned}
                onChange={(e) => setAssigned(Math.min(max, Number(e.target.value) || 0))}
              />
              <div className="centerButton">
                <input
                  className={assigned === Math.floor(town.templer) ? 'button' : 'buttonChanged'}
                  type="submit"
                  value={t('confirm')}
                />
              </div>
              {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
            </div>
            <div className="footer" />
          </div>
        </form>

        <MiraclePanel ctx={ctx} />
      </div>
    </>
  )
}

/**
 * The island's wonder, and whether the priests may call it.
 *
 * Everything shown here is decided on the server too -- faith comes down with
 * the state because it sums over towns this player cannot see, and the level it
 * unlocks is recomputed when the button is pressed.
 */
function MiraclePanel({ ctx }: { ctx: ScreenContext }) {
  const island = ctx.island
  const wonder = island.wonder
  const spec = MIRACLES[wonder]
  if (!wonder || !spec) return null

  const faith = ctx.chrome.faith?.[island.id]?.faith ?? 0
  const faithLevel = miracleLevelForFaith(faith)
  const wonderLevel = island.wonderLevel
  // Both halves decide this, so both are shown: the effect the priests would
  // get is the smaller of what the island believes and what the monument can
  // carry, and a single clamped number would not say which one to go and fix.
  const level = effectiveMiracleLevel(wonderLevel, faith)
  const active = ctx.state.user.miracles.find((m) => m.islandId === island.id)
  // The running effect is timed by the wonder that was *called*, which is what
  // the row stores; `spec` above is the island's wonder as it stands now. The
  // two agree in every real game, and the server reads the stored one too.
  const activeSpec = active ? MIRACLES[active.wonder] : undefined
  // The same temple count the server uses, so the countdown shown is the
  // shortened one a second temple on this god has earned.
  const temples = templesForWonder(ctx.state, wonder)
  const window =
    active && activeSpec
      ? miracleWindow(activeSpec, active.activatedAt, ctx.now, temples)
      : null

  const effectLevel = Math.max(1, level)

  return (
    <div id="miracle" className="contentBox01h">
      <h3 className="header">
        <span className="textLabel">{t('miracle')}: </span>
        {t(`wonder_${wonder}`)}
      </h3>
      <div className="content">
        <p>{t(`wonder${wonder}_desc`)}</p>
        <ul>
          <li>
            <span className="textLabel">{t('island_faith')}: </span>
            <span className="value">{percent(faith)}</span>{' '}
            <span className="timeUnit">
              ({t('level')} {faithLevel})
            </span>
          </li>
          <li>
            <span className="textLabel">{t('wonder_level')}: </span>
            <a
              href={hashFor('wonder', island.id)}
              onClick={(e) => {
                e.preventDefault()
                ctx.navigate(hashFor('wonder', island.id))
              }}
            >
              {wonderLevel}/5
            </a>
          </li>
          <li>
            <span className="textLabel">{t('effect')}: </span>
            {t(`wonder${wonder}_level${effectLevel}`)}
          </li>
          <li>
            <span className="textLabel">{t('duration')}: </span>
            {formatTime(spec.duration)}
            {'  '}
            <span className="textLabel">{t('cooldown')}: </span>
            {formatTime(cooldownFor(spec, temples))}
          </li>
        </ul>

        {/* Called like any other god; the effect lands once this port has a
            fight to apply armour, morale and refunds to. */}
        {spec.combat && <p className="notice">{t('miracle_needs_combat')}</p>}

        {window && window.activeFor > 0 && (
          <p className="notice">
            {t('miracle_active_for')}{' '}
            <Countdown
              endsAt={ctx.now + window.activeFor}
              clockOffset={ctx.clockOffset}
              onFinish={ctx.refresh}
            />
          </p>
        )}

        <div className="centerButton">
          {level < 1 ? (
            <span className="error">{tf('faith_too_low_hint', '20%')}</span>
          ) : window && window.cooldownFor > 0 ? (
            <span className="textLabel">
              {t('miracle_cooling_down')}{' '}
              <Countdown
                endsAt={ctx.now + window.cooldownFor}
                clockOffset={ctx.clockOffset}
                onFinish={ctx.refresh}
              />
            </span>
          ) : (
            <a
              className="button"
              href="#miracle"
              title={t('miracle_activate')}
              onClick={(e) => {
                e.preventDefault()
                void ctx.act('activateMiracle', { islandId: island.id })
              }}
            >
              {t('miracle_activate')} — {t('level')} {level}
            </a>
          )}
        </div>
      </div>
      <div className="footer" />
    </div>
  )
}
