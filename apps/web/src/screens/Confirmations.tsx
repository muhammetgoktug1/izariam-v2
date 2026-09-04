/**
 * Four short forms that share nothing but their size, kept together so each
 * stays one screenful: rename the town, confirm a demolition, abandon a colony,
 * and write a message.
 *
 * izariam/views/view/{renameCity,demolition,abolishColony,sendIKMessage}.php.
 */

import { buildingCost, levelsByType } from '@izariam/rules'
import { useState } from 'react'

import { buildingClass, buildingName } from '../lib/buildings.js'
import { num, t } from '../lib/i18n.js'
import { hashFor, isPage } from '../lib/routes.js'
import type { Screen } from './context.js'

/**
 * renameCity.php. Every string is hardcoded Russian and the heading is
 * "Ратуша" -- the town hall -- rather than anything about renaming; the box
 * below it carries the real title.
 *
 * `maxlength=15` on the field, but the action accepts up to 30 and the column
 * holds 30, so the limit is advisory.
 */
export const RenameCityScreen: Screen = ({ ctx, sideboxes }) => {
  const [name, setName] = useState(ctx.town.name)

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <h1 style={{ textAlign: 'center' }}>{t('building1_name')}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ctx.act('renameTown', { townId: ctx.town.id, name })
          }}
        >
          <div id="renameCity" className="contentBox01h">
            <h3 className="header">{t('rename_city')}</h3>
            <div className="content">
              <div className="oldCityName">
                <span className="textLabel">{t('old_town_name')}: </span>
                {ctx.town.name}
              </div>
              <div className="newCityName">
                <label htmlFor="newCityName">{t('new_town_name')}: </label>
                <input
                  name="name"
                  id="newCityName"
                  maxLength={15}
                  size={30}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input type="submit" className="button" value={t('accept_name')} />
              </div>
              {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
            </div>
            <div className="footer" />
          </div>
        </form>
      </div>
    </>
  )
}

/**
 * demolition.php -- one confirm screen doing two jobs.
 *
 * If this slot is at the head of the build queue it cancels the build and
 * refunds the cost of the level being built; otherwise it demolishes a level
 * and refunds the cost of the level *below* the current one. Both refund 90%.
 *
 * LEGACY BUG, reproduced: on an empty slot the else branch prices level -1,
 * which `buildingCost` clamps to 0, so demolishing nothing refunds 90% of a
 * first level. The action does the same thing, so the screen is honest about
 * what will happen (building.ts:291).
 */
export const DemolitionScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const slot = ctx.town.buildings.bySlot[position] ?? { type: 0, level: 0 }
  const head = ctx.town.buildQueue[0]
  const cancelling = head?.slot === position && ctx.town.buildStartedAt != null

  const cost = buildingCost(
    slot.type,
    cancelling ? slot.level : slot.level - 1,
    ctx.state.user.research,
    levelsByType(ctx.town),
  )

  const back = buildingClass(slot.type)
  const backHash = isPage(back) ? hashFor(back, position) : hashFor('city')

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <h1>{buildingName(slot.type)}</h1>
        <div className="contentBox" id="demolition">
          <h3 className="header">
            {cancelling ? t('confirm_building_cancel') : t('confirm_demolish')}
          </h3>
          <div className="content">
            <h4>{t('warning')}</h4>
            <p>{cancelling ? t('building_cancel_text') : t('demolish_text')}</p>
            {/* The legacy opens a <p> here and never closes it before the
                list, which browsers auto-close; written as siblings so the
                rendered tree matches what the browser actually built. */}
            <p className={cancelling ? 'refund' : undefined}>
              {cancelling ? t('following_resources_1') : t('following_resources_2')}
            </p>
            <ul className="resources">
                {/* The legacy orders these wood, marble, wine, crystal,
                    sulfur -- marble before wine, unlike every other list. */}
                {(['wood', 'marble', 'wine', 'crystal', 'sulfur'] as const).map((r) =>
                  cost[r] > 0 ? (
                    <li key={r} className={r === 'crystal' ? 'glass' : r} title={t(r)}>
                      <span className="textLabel">{t(r)}: </span>
                      {num(cost[r] * 0.9)}
                    </li>
                  ) : null,
                )}
            </ul>
            <hr />
            <a
              className="yes"
              href="#"
              title={t('yes')}
              onClick={(e) => {
                e.preventDefault()
                void ctx.act('demolish', { townId: ctx.town.id, slot: position }).then(() =>
                  ctx.navigate(backHash),
                )
              }}
            >
              {t('yes')}
            </a>
            <a
              className="no"
              href={backHash}
              title={t('no')}
              onClick={(e) => {
                e.preventDefault()
                ctx.navigate(backHash)
              }}
            >
              <span className="textLabel">{t('no')}</span>
            </a>
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

/**
 * abolishColony.php. On the capital the legacy still renders a submit button,
 * just outside any form and captioned "you cannot leave the capital" -- so it
 * looks live and does nothing. Reproduced as a disabled control, which is the
 * same outcome without the pretence.
 */
export const AbolishColonyScreen: Screen = ({ ctx, sideboxes }) => {
  const isCapital = ctx.town.id === ctx.state.user.capitalTownId
  return (
    <>
      {sideboxes}
      <div id="mainview">
        <h1>{t('leave_colony')}</h1>
        <p>{t('leave_colony_text')}</p>
        {isCapital ? (
          <div className="centerButton">
            <input type="submit" className="button" value={t('no_leave_capital')} disabled />
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void ctx.act('abolishColony').then(() => ctx.navigate(hashFor('city')))
            }}
          >
            <div className="centerButton">
              <input type="submit" className="button" value={t('leave_colony')} />
            </div>
          </form>
        )}
        {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
      </div>
    </>
  )
}

/**
 * sendIKMessage.php. The recipient comes from the URL -- there is no user
 * search -- so the screen is reachable only from a link that already knows who
 * it is writing to. Every such link (island board, wonder roster, highscore)
 * also knows the name, so it travels as the second hash segment and the id
 * stays the truth the action reads.
 *
 * The form is the legacy's `#notice`: the parchment sheet ik_common paints
 * behind it, the bold `.maillabels` rows for recipient and subject, the
 * 8000-character counter that turns red past the limit, and the one legal
 * treaty setting -- the action validates `type > 0 and <= 1`, so the select
 * exists but has exactly one option.
 */
export const SendMessageScreen: Screen = ({ ctx, sideboxes }) => {
  const toUserId = ctx.route.params[0]
  const recipient = ctx.route.raw[1]
    ? decodeURIComponent(ctx.route.raw[1])
    : `#${toUserId}`
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const remaining = 8000 - text.replaceAll('\r\n', '\n').length

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('create_message')}</h1>
          <p>{t('send_message_intro')}</p>
        </div>
        <div id="notice">
          {sent ? (
            <h3>{t('message_sent')}</h3>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void ctx
                  .act('sendUserMessage', { toUserId, type: 1, text })
                  .then(() => setSent(true))
              }}
            >
              <div id="mailRecipient">
                <span className="maillabels">
                  <label>{t('addressee')}: </label>
                </span>
                <span>{recipient}</span>
              </div>
              <div id="mailSubject">
                <span className="maillabels">
                  <label htmlFor="treaties">{t('subject')}: </label>
                </span>
                <span>
                  <select name="msgType" id="treaties">
                    <option value="1">{t('message')}</option>
                  </select>
                </span>
              </div>
              <span className="maillabels">
                <label htmlFor="text">{t('message')}: </label>
              </span>
              <br />
              <span>
                <textarea
                  id="text"
                  className="textfield"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </span>
              <br />
              <div id="nr_chars_div" style={{ display: text ? 'block' : 'none' }}>
                {t('send_chars_1')}{' '}
                <span
                  style={
                    remaining < 0 ? { color: '#f00', fontWeight: 'bold' } : undefined
                  }
                >
                  {remaining}
                </span>{' '}
                {t('send_chars_2')}
              </div>
              <div className="centerButton">
                <input type="submit" className="button" value={t('send')} title={t('send')} />
              </div>
            </form>
          )}
          {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
        </div>
      </div>
    </>
  )
}
