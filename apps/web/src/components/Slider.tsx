/**
 * The assignment slider, replacing `create_slider()` from
 * design/js/complete-0.0.1.js.
 *
 * Used by the academy (scientists), the two island-node screens (workers), the
 * tavern (wine), the barracks and shipyard (recruits) and the garrison editor.
 * The legacy version was a drag handler over an absolutely positioned thumb;
 * all the geometry is in the skin, so the markup contract is the whole job:
 *
 *   div.sliderbg#{bg} > div.actualValue#{value} + div.overcharge + div#{thumb}
 *
 * `sliderbg` is a **class**, and it carries an id as well, because the skin
 * addresses this element both ways depending on the screen
 * (izariam/views/view/barracks.php:61):
 *
 *   #mainview .sliderinput .sliderbg{…}        barracks, shipyard, tavern, garrison
 *   #academy #mainview #setScientists #sliderbg{…}    academy
 *   #setWorkers #sliderbg{…}                          island nodes
 *
 * Nothing here may set `position` inline. The two families disagree about it --
 * the class rules say `relative`, the id rules say `absolute` with a `top`/
 * `left` -- and an inline value wins over both, which is what left the academy
 * slider sitting in the flow underneath its own number field.
 *
 * The thumb travels from the track's left padding to `paddingLeft + width -
 * thumbWidth`: 10..326 on the 332px unit-card track, 10..344 on the 350px
 * worker track (complete-0.0.1.js:171). `actualValue` is clipped to the thumb's
 * centre, half a thumb further right.
 *
 * A range input is layered over the track, transparent and full-size, so the
 * control is keyboard- and touch-operable without reimplementing a drag
 * handler. The legacy had neither.
 */

import { useId } from 'react'

import { t } from '../lib/i18n.js'

interface Props {
  value: number
  max: number
  onChange: (value: number) => void
  /** Element ids, because the skin selects several of them directly. */
  bgId?: string
  valueId?: string
  thumbId?: string
  /** Thumb travel in pixels: the track's left padding to
   *  `paddingLeft + width - thumbWidth`. 10..344 for the worker tracks,
   *  10..326 for the narrower unit-card ones. */
  from?: number
  to?: number
  /** The academy's slider is the only one that renders an overcharge band. */
  overcharge?: boolean
}

export function Slider({
  value,
  max,
  onChange,
  bgId = 'sliderbg',
  valueId = 'actualValue',
  thumbId = 'sliderthumb',
  from = 10,
  to = 344,
  overcharge = false,
}: Props) {
  const inputId = useId()
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const left = from + (to - from) * fraction

  return (
    <div className="sliderbg" id={bgId}>
      <div
        className="actualValue"
        id={valueId}
        /* `position[0] + thumb.offsetWidth / 2`, and the thumb is 16px wide
           (complete-0.0.1.js:184). */
        style={{ clip: `rect(0px, ${Math.max(0, left + 8)}px, auto, 0px)` }}
      />
      {overcharge && <div className="overcharge" id="overcharge" />}
      <div id={thumbId} className="sliderthumb" style={{ left: `${left}px`, top: 0 }} />
      <input
        id={inputId}
        type="range"
        min={0}
        max={Math.max(0, max)}
        value={Math.min(value, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={t('assignment')}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
          margin: 0,
        }}
      />
    </div>
  )
}
