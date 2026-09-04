/**
 * The tutorial overlay, izariam/views/tut/0-8.php.
 *
 * 2,827 lines across ten files that are the same skeleton: an advisor portrait
 * pinned to the play area, a message box beside it, and an arrow pointing at
 * whatever the step wants clicked. Only four things vary -- which advisor, the
 * caption, the body text, and whether the portrait is lit -- so it becomes one
 * component and a nine-row table.
 *
 * `users.tutorial` holds sixteen states mapping onto nine templates: every step
 * after the welcome has an active and a passive variant (view_model.php:163),
 * and the two differ only by the `lighten` class. State 999 means the player
 * opted out.
 *
 * `tut/9.php`, the attack-the-barbarians step, is 297 lines and unreachable:
 * its two cases at :192-193 are commented out. Not ported.
 *
 * The overlay only appears in the capital, and never on the highscore page
 * (game_index.php:627). Both conditions are the caller's.
 *
 * The advisor sprite and the close button are styled by inline `<style>`
 * blocks in the PHP and appear in no .css file, so those rules travel with this
 * component. `#tutorialMessage` is the exception: the skin does own it
 * (ik_common_0.4.5.css:4754) and sets `display:none`, which the legacy's
 * `showMessage()` overrides. Here that is React state -- the box starts open
 * and the portrait toggles it.
 */

import { useState } from 'react'

import { t } from '../lib/i18n.js'

/**
 * Style block lifted from tut/0.php:9-70. The advisor sprite, the message box
 * and the pointing arrow are positioned absolutely against the play area.
 */
const TUTORIAL_STYLES = `
#arrow{background-image:url('/skin/tutorial/arrow.gif');height:48px;width:40px;position:absolute;z-index:10000}
#tutorialAdvisor{left:260px;position:absolute;top:185px;z-index:50}
#tutorialAdvisor div{background-image:url('/skin/tutorial/advisors.gif');height:67px;width:66px}
#tutorialAdvisor div a{display:block;height:67px;width:66px}
#tutorialAdvisor div.lighten{background-image:url('/skin/tutorial/advisors_lighten.gif');width:66px;height:67px}
#tutorialAdvisor div.invisible{display:none}
#tutorialAdvisorCloseLink{background-image:url('/skin/layout/notice_close.gif');cursor:pointer;height:18px;left:535px;position:absolute;top:9px;width:18px}
`

/**
 * One row per template. `advisor` is the sprite class the portrait takes when
 * the player is in the city; anywhere else it is `invisible`, so the overlay
 * vanishes off-screen rather than following them around.
 */
interface Step {
  advisor: string
  captionKey: string
  /** Into HARDCODED / HARDCODED_TR; the nine scripts are port text, because the
   *  legacy kept them in the templates rather than the language file. */
  bodyKey: string
}

const STEPS: Record<number, Step> = {
  0: {
    advisor: 'allAdvisors',
    captionKey: 'tutorial',
    bodyKey: 'tut0_body',
  },
  1: {
    advisor: 'cityAdvisor',
    captionKey: 'training',
    bodyKey: 'tut1_body',
  },
  2: {
    advisor: 'cityAdvisor',
    captionKey: 'training',
    bodyKey: 'tut2_body',
  },
  3: {
    advisor: 'researchAdvisor',
    captionKey: 'training',
    bodyKey: 'tut3_body',
  },
  4: {
    advisor: 'cityAdvisor',
    captionKey: 'training',
    bodyKey: 'tut4_body',
  },
  5: {
    advisor: 'militaryAdvisor',
    captionKey: 'training',
    bodyKey: 'tut5_body',
  },
  6: {
    advisor: 'militaryAdvisor',
    captionKey: 'training',
    bodyKey: 'tut6_body',
  },
  7: {
    advisor: 'diplomacyAdvisor',
    captionKey: 'training',
    bodyKey: 'tut7_body',
  },
  8: {
    advisor: 'cityAdvisor',
    captionKey: 'training',
    bodyKey: 'tut8_body',
  },
}

/**
 * `users.tutorial` -> template, and whether the portrait is lit. Straight from
 * the switch at view_model.php:164-192.
 */
const STATE_TO_STEP: Record<number, { step: number; active: boolean }> = {
  0: { step: 0, active: true },
  1: { step: 1, active: true },
  2: { step: 1, active: false },
  3: { step: 2, active: true },
  4: { step: 2, active: false },
  5: { step: 3, active: true },
  6: { step: 3, active: false },
  7: { step: 4, active: true },
  8: { step: 4, active: false },
  9: { step: 5, active: true },
  10: { step: 5, active: false },
  // State 11's only case passes active: false -- the wall step is never lit.
  11: { step: 6, active: false },
  12: { step: 7, active: true },
  13: { step: 7, active: false },
  14: { step: 8, active: true },
  15: { step: 8, active: false },
}

interface Props {
  /** `users.tutorial`. 999 or anything unmapped renders nothing. */
  state: number
  /** The current page key; the portrait only shows itself in the city. */
  page: string
  onNext: () => void
  onSkip: () => void
}

export function Tutorial({ state, page, onNext, onSkip }: Props) {
  const [open, setOpen] = useState(true)
  const mapped = STATE_TO_STEP[state]
  if (!mapped) return null
  const step = STEPS[mapped.step]
  if (!step) return null

  // Step 0 shows its portrait everywhere; the rest hide outside the city.
  const advisor =
    mapped.step === 0 ? step.advisor : page === 'city' ? step.advisor : 'invisible'
  const className = mapped.active ? `lighten ${advisor}` : advisor

  return (
    <>
      <style>{TUTORIAL_STYLES}</style>
      <div id="tutorialAdvisor">
        <div id="advisorImage" className={className}>
          <a
            href="#"
            id="tutorialAdvisorLink"
            title={t(step.captionKey)}
            onClick={(e) => {
              e.preventDefault()
              setOpen((v) => !v)
            }}
          />
        </div>
      </div>
      <div id="tutorialMessage" style={{ display: open ? 'block' : 'none' }}>
        <h3>{t(step.captionKey)}</h3>
        <a
          href="#"
          id="tutorialAdvisorCloseLink"
          title={t('close')}
          onClick={(e) => {
            e.preventDefault()
            setOpen(false)
          }}
        />
        <div className="content">
          <p>{t(step.bodyKey)}</p>
          <div className="centerButton">
            <a
              href="#"
              id="okButton"
              className="button"
              onClick={(e) => {
                e.preventDefault()
                onNext()
              }}
            >
              {t('ok')}
            </a>
            {/* The legacy has no opt-out button here at all: the only way out
                is `actions/tutorials/set/999`, which nothing links to. Added,
                because a tutorial with no exit is a defect rather than a
                design. */}
            <a
              href="#"
              className="button"
              onClick={(e) => {
                e.preventDefault()
                onSkip()
              }}
            >
              {t('skip')}
            </a>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}
