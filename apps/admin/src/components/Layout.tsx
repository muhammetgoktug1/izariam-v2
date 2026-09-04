/**
 * The shell: a sidebar on the left, the screen beside it.
 *
 * The links are real hashes, so the back button and a copied URL both work, and
 * they carry no query string -- clicking "Oyuncular" from a filtered list is
 * how you clear the filter.
 *
 * There is no drawer state here on purpose. Under 860px the stylesheet lays
 * these same elements out as the horizontal strip the header used to be, so
 * this component stays a pure function of its props: no toggle, no Escape
 * handler, no effect that has to remember to close the menu when the hash
 * changes.
 */

import type { ReactNode } from 'react'

import type { Admin } from '../lib/api.js'
import { hashFor, type Page } from '../lib/routes.js'

interface Props {
  admin: Admin
  page: Page
  onLogout: () => void
  children: ReactNode
}

/** A tiny pediment-and-columns glyph, the game's whole aesthetic in 20px. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5 12 3.5l8.5 5"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4 20h16" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

const ICONS: Partial<Record<Page, ReactNode>> = {
  summary: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  ),
  players: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.9M21.5 20c-.4-2.4-1.6-4.1-3.5-5" />
    </svg>
  ),
  admins: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.8 4.5 5.5v6c0 4.6 3.1 8 7.5 9.7 4.4-1.7 7.5-5.1 7.5-9.7v-6z" />
      <path d="m9 11.6 2.1 2.1 4-4.2" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 3.5V2.6A1.1 1.1 0 0 1 10.1 1.5h3.8A1.1 1.1 0 0 1 15 2.6v.9" />
      <path d="M8.8 9h6.4M8.8 12.7h6.4M8.8 16.4h4" />
    </svg>
  ),
}

/** In the order a shift runs: what you check, who you moderate, who else holds
 *  keys, and what everybody did. The grant form has no entry of its own on
 *  purpose: it is reached from a player row's "Kaynak ver" button, so nobody
 *  lands on it without already having chosen the account. */
const TABS: { page: Page; label: string }[] = [
  { page: 'summary', label: 'Özet' },
  { page: 'players', label: 'Oyuncular' },
  { page: 'admins', label: 'Yöneticiler' },
  { page: 'audit', label: 'Denetim kaydı' },
]

function initials(nameOrEmail: string): string {
  const source = nameOrEmail.split('@')[0] ?? nameOrEmail
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')
}

export function Layout({ admin, page, onLogout, children }: Props) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="brand">
          <span className="mark">
            <Mark />
          </span>
          <span className="text">
            <b>iZariam</b>
            <small>Yönetim Paneli</small>
          </span>
        </h1>
        <nav className="nav" aria-label="Bölümler">
          {TABS.map((tab) => (
            <a
              key={tab.page}
              href={hashFor(tab.page)}
              className={page === tab.page ? 'active' : undefined}
              // The class is the paint; this is the fact. A screen reader
              // announces "current page" without knowing what .active means.
              aria-current={page === tab.page ? 'page' : undefined}
            >
              {ICONS[tab.page]}
              {tab.label}

            </a>
          ))}
        </nav>
        <div className="foot">
          <div className="user">
            <span className="avatar">{initials(admin.name || admin.email)}</span>
            <span className="meta">
              <span className="who">{admin.name || admin.email}</span>
              <br />
              <span className="role">Yönetici</span>
            </span>
          </div>
          <button onClick={onLogout}>Çıkış</button>
        </div>
      </aside>
      <main className="content">
        <div className="page">{children}</div>
      </main>
    </div>
  )
}
