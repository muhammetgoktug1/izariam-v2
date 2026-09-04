/** Every screen's heading block: a title, a one-line subtitle and the actions
 *  that belong to the whole page (as opposed to one row or one card). */

import type { ReactNode } from 'react'

export function PageHeader({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children?: ReactNode
}) {
  return (
    <header className="page-head">
      <div className="titles">
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  )
}
