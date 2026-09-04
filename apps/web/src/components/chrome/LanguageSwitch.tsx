/**
 * The language picker, standing in for the legacy netbar's lang_bar.php that
 * controllers/main.php:48-87 served through `Main::language()` (where
 * `turkish` was a commented-out case and only Spanish ever shipped). This
 * port's pair is Turkish -- the default -- and English.
 *
 * Styled by whatever cascade surrounds it: the game netbar's `#GF_toolbar a`
 * rule and the start page's own link styles both apply to plain anchors, so
 * the switch renders as two text links, the active one dimmed.
 */

import { getLocale, LOCALES, setLocale } from '../../lib/i18n.js'

const INACTIVE: React.CSSProperties = {
  fontWeight: 'bold',
  textDecoration: 'none',
  cursor: 'default',
}

export function LanguageSwitch() {
  const current = getLocale()
  return (
    <>
      {LOCALES.map((entry, index) => (
        <span key={entry.code}>
          {index > 0 && ' | '}
          <a
            href={`#lang-${entry.code}`}
            style={entry.code === current ? INACTIVE : undefined}
            onClick={(e) => {
              e.preventDefault()
              setLocale(entry.code)
            }}
          >
            {entry.label}
          </a>
        </span>
      ))}
    </>
  )
}
