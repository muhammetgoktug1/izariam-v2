/**
 * The landing screen: what the world looks like right now, as one wall of
 * numbers. The recent-actions feed and the highscore list used to live here
 * too; they were cut on purpose -- both are one click away in their own
 * screens (Denetim kaydı, Oyuncular), and the dashboard's job is the answer
 * to "how are things?", not "what exactly happened?".
 *
 * One query, because `main.tsx` refetches on every mount -- nine tiles from
 * nine endpoints would be nine round trips and nine loading states.
 */

import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '../components/PageHeader.js'
import { api } from '../lib/api.js'
import { num } from '../lib/format.js'

/** One stroke-drawn glyph per tile, 21px, coloured by the tile's chip. */
function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

const PATHS = {
  players:
    'M12 12.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM5 20c.6-3.7 3.3-5.7 7-5.7s6.4 2 7 5.7',
  ban: 'M12 3.5 4.8 6v5.7c0 4.4 3 7.7 7.2 9.3 4.2-1.6 7.2-4.9 7.2-9.3V6zM8.6 12l6.8 4.1m0-4.1-6.8 4.1',
  online: 'M12 10.8a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM5 19.5c.5-3 3-4.7 7-4.7 1 0 1.9.1 2.7.4M17.5 13.5v5M15 16h5',
  session: 'M8 10.5V7a4 4 0 0 1 8 0v3.5M5.5 10.5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
  newDay: 'M9.5 12.5h5M12 10v5M15.5 4.5h-7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2zM10 2.8v3.4M14 2.8v3.4',
  town: 'M4 20.2h16M6 20V9.8l6-4.3 6 4.3V20M9.8 20v-4.4h4.4V20M9.5 10.2h.01M14.5 10.2h.01',
  admins: 'M12 3 4.8 5.5v5.9c0 4.5 3 7.9 7.2 9.6 4.2-1.7 7.2-5.1 7.2-9.6V5.5zM9.3 11.9l2 2 3.6-3.8',
  actionsDay: 'M3.5 12h3.2l2-5 3.6 10 2-5h5.2',
  week: 'M8 4.5H5.5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1H16M8.6 2.5h6.8v3.9H8.6zM8 11h8M8 14.7h8M8 18.4h5',
}

export function Summary() {
  const summary = useQuery({ queryKey: ['summary'], queryFn: api.summary })

  if (summary.isPending)
    return (
      <>
        <PageHeader title="Özet" sub="Sunucunun şu anki durumu" />
        <p className="loading">Yükleniyor…</p>
      </>
    )
  if (!summary.data)
    return (
      <>
        <PageHeader title="Özet" sub="Sunucunun şu anki durumu" />
        <p className="empty">Özet alınamadı.</p>
      </>
    )

  const { counts } = summary.data

  const tiles: {
    label: string
    value: string
    icon: keyof typeof PATHS
    color: string
    warn?: boolean
  }[] = [
    { label: 'Toplam oyuncu', value: num(counts.players), icon: 'players', color: 'green' },
    {
      label: 'Aktif yasak',
      value: num(counts.banned),
      icon: 'ban',
      color: counts.banned > 0 ? 'red' : 'green',
      warn: counts.banned > 0,
    },
    { label: 'Son 15 dk. içinde aktif', value: num(counts.online), icon: 'online', color: 'blue' },
    { label: 'Açık oturum', value: num(counts.openSessions), icon: 'session', color: 'violet' },
    { label: 'Son 24 saatte kayıt', value: num(counts.newDay), icon: 'newDay', color: 'cyan' },
    { label: 'Son 7 günde kayıt', value: num(counts.newWeek), icon: 'week', color: 'cyan' },
    { label: 'Şehir', value: num(counts.towns), icon: 'town', color: 'amber' },
    {
      label: 'Panel kullanıcısı',
      value: `${num(counts.adminsActive)} / ${num(counts.admins)}`,
      icon: 'admins',
      color: 'blue',
    },
    {
      label: 'Son 24 saatte panel işlemi',
      value: num(counts.actionsDay),
      icon: 'actionsDay',
      color: 'violet',
    },
  ]

  return (
    <>
      <PageHeader title="Özet" sub="Sunucunun şu anki durumu" />
      <div className="stats">
        {tiles.map((tile) => (
          <div key={tile.label} className="stat">
            <div className={`icon ${tile.color}`}>
              <Icon d={PATHS[tile.icon]} />
            </div>
            <div>
              <div className={tile.warn ? 'value warn' : 'value'}>{tile.value}</div>
              <div className="label">{tile.label}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
