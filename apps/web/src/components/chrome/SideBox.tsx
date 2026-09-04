/**
 * Left-hand panel, reproducing the contract every file in
 * izariam/views/sidebox/ follows: `div.dynamic > h3.header + .content +
 * div.footer` (design/skin/ik_common_0.4.5.css:344-353).
 *
 * There is no shared wrapper in the legacy -- show_sidebox emits one or more
 * sibling `.dynamic` blocks straight into #container2
 * (izariam/models/view_model.php:91-161). `#mainview` leaves the gutter for
 * them with `margin-left:251px` (ik_common_0.4.5.css:325-327), so with no
 * `.dynamic` box that strip is just empty parchment.
 *
 * Note `#sidebox` -- what the first cut of this client used -- appears in no
 * stylesheet at all.
 */

import type { ReactNode } from 'react'

interface Props {
  id: string
  title: ReactNode
  children: ReactNode
}

export function SideBox({ id, title, children }: Props) {
  return (
    <div id={id} className="dynamic">
      <h3 className="header">{title}</h3>
      <div className="content">{children}</div>
      <div className="footer" />
    </div>
  )
}
