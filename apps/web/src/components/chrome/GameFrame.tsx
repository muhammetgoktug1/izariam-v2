/**
 * The outer frame, reproducing izariam/views/game_index.php:296-329 and
 * :658-721.
 *
 * `#header` is a decorative banner and nothing else. The skin hides its
 * contents outright:
 *
 *   #header *{display:none}      design/skin/ik_common_0.4.5.css:86
 *
 * so every functional block -- the city nav, both resource boxes, the
 * advisors -- is a *sibling* of it, never a child. Nesting anything useful
 * inside makes it silently invisible.
 *
 * The extraDiv/conExtraDiv elements are not filler: `#extraDiv1` and
 * `#extraDiv2` carry the sky and ocean that the whole page sits on
 * (ik_common_0.4.5.css:342-343), and the conExtraDivs are the parchment
 * corners. Several of the sprites are painted on the inner <span>, so the
 * empty span has to be there too.
 */

import type { ReactNode } from 'react'

/** Decorative sprite holder. The inner span is load-bearing. */
function Decoration({ id }: { id: string }) {
  return (
    <div id={id}>
      <span />
    </div>
  )
}

interface Props {
  children: ReactNode
}

export function GameFrame({ children }: Props) {
  return (
    <>
      <div id="container">
        <div id="container2">
          {/* Banner slots (game_index.php:298-325) are commented out in the
              legacy and stay out here. */}
          <div id="header">
            <h1 />
            <h2 />
          </div>

          {children}

          <Decoration id="conExtraDiv1" />
          <Decoration id="conExtraDiv2" />
          <Decoration id="conExtraDiv3" />
          <Decoration id="conExtraDiv4" />
          <Decoration id="conExtraDiv5" />
          <Decoration id="conExtraDiv6" />
        </div>
      </div>

      {/* Outside #container, as in the legacy: these two hold the sky and
          the ocean behind everything. */}
      <Decoration id="extraDiv1" />
      <Decoration id="extraDiv2" />
      <Decoration id="extraDiv3" />
      <Decoration id="extraDiv4" />
      <Decoration id="extraDiv5" />
      <Decoration id="extraDiv6" />
    </>
  )
}
