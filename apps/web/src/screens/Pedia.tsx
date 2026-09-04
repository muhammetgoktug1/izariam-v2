/**
 * The encyclopedia and the general-information pages,
 * izariam/views/view/{pedia,informations}.php.
 *
 * 811 lines each, and the same 811 lines: a `case` per topic holding a title,
 * a run of headings, paragraphs and pictures, then prev/next links. Every
 * string is a language key, so the port keeps only the order -- extracted to
 * packages/gamedata/pedia.json by tools/extract-pedia.py -- and renders both
 * files from one component.
 *
 * The two differ in their topic numbering: `pedia` runs 0, 3..34 and
 * `informations` runs 1..34, so "next" has to walk the sorted key list rather
 * than add one. The legacy hardcoded each link, which is why several of them
 * point at topics that do not exist in the file doing the linking.
 *
 * `pedia0_0` and `pedia0_0_1` are missing from the language file, so the first
 * topic's title and subtitle were blank -- in the legacy too. Both are filled
 * in HARDCODED now: a missing caption reads as a bug rather than as fidelity.
 */

import { PEDIA, type PediaBlock } from '@izariam/gamedata'

import { t } from '../lib/i18n.js'
import { hashFor, type Page } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

function Topic({ ctx, book }: { ctx: ScreenContext; book: 'pedia' | 'informations' }) {
  const topics = PEDIA[book]
  const numbers = Object.keys(topics)
    .map(Number)
    .sort((a, b) => a - b)

  const requested = ctx.route.params[0]
  const current = topics[String(requested)] ? requested : (numbers[0] ?? 0)
  const index = numbers.indexOf(current)
  const previous = index > 0 ? numbers[index - 1] : undefined
  const next = index >= 0 && index < numbers.length - 1 ? numbers[index + 1] : undefined

  const blocks: PediaBlock[] = topics[String(current)] ?? []
  const page = book as Page

  const title = (n: number) => {
    const first = topics[String(n)]?.find((b) => b.kind === 'title' || b.kind === 'heading')
    return first && 'key' in first ? t(first.key) : ''
  }

  const link = (n: number, dir: 'prev' | 'next') => (
    <a
      title={`${t(dir === 'next' ? 'foward_topic' : 'back_topic')}: ${title(n)}`}
      href={hashFor(page, n)}
      onClick={(e) => {
        e.preventDefault()
        ctx.navigate(hashFor(page, n))
      }}
    >
      {/* The legacy uses the deprecated align attribute; the skin has no
          rule for these arrows, so the alignment has to survive. */}
      {dir === 'prev' && (
        <img src="/skin/layout/prev.gif" alt="" style={{ verticalAlign: 'middle' }} />
      )}
      {title(n)}
      {dir === 'next' && (
        <img src="/skin/layout/next.gif" alt="" style={{ verticalAlign: 'middle' }} />
      )}
    </a>
  )

  return (
    <div id="mainview">
      <div className="informations">
        {blocks.map((block, i) => {
          if (block.kind === 'image') {
            return (
              <span key={i}>
                <img src={block.src} alt="" />
                &nbsp;&nbsp;
              </span>
            )
          }
          if (block.kind === 'title') {
            return (
              <h1 key={i} className="informationsTitel">
                {t(block.key)}
              </h1>
            )
          }
          if (block.kind === 'heading') return <h2 key={i}>{t(block.key)}</h2>
          return (
            <div key={i} className="content">
              {t(block.key)}
            </div>
          )
        })}

        <div className="navigation">
          <table cellPadding={0} cellSpacing={0} width="100%">
            <tbody>
              <tr>
                <td width="50%" align="left">
                  {previous !== undefined && link(previous, 'prev')}
                </td>
                <td width="50%" align="right">
                  {next !== undefined && link(next, 'next')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="footer" />
    </div>
  )
}

export const PediaScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <Topic ctx={ctx} book="pedia" />
  </>
)

export const InformationsScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <Topic ctx={ctx} book="informations" />
  </>
)
