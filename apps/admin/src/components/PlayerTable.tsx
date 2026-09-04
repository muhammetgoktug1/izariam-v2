/**
 * The player list, shared by the two screens that need one.
 *
 * Extracted rather than copied: "Oyuncular" and the picker on "Kaynak ver" are
 * meant to be the same table, and two tables that are the same by convention
 * stop being the same at the first fix -- the sort whitelist, the ban badge and
 * the pager arithmetic would each drift on their own.
 *
 * What varies between the two is only the right-hand cell and the toolbar, so
 * both arrive as render props. The search *value* is owned by the screen, not
 * by this component: it lives in the hash (`#/players?q=` and
 * `#/resources?q=`), so a filtered list can be linked and survives a reload.
 */

import type { AdminPlayerSort } from '@izariam/shared/admin'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { api, type PlayerRow } from '../lib/api.js'
import { banLabel, num, when } from '../lib/format.js'

const PER_PAGE = 25

const COLUMNS: { key: AdminPlayerSort; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'login', label: 'Kullanıcı adı' },
  { key: 'towns', label: 'Şehir' },
  { key: 'created', label: 'Kayıt' },
  { key: 'lastVisit', label: 'Son giriş' },
  { key: 'banned', label: 'Durum' },
]

export function PlayerTable({
  title,
  search,
  onSearch,
  actions,
  toolbar,
  notice,
}: {
  /** Optional: the screen's PageHeader usually names the list already. */
  title?: string
  search: string
  /** Where to write the filter. Each screen owns its own hash key. */
  onSearch: (q: string) => void
  actions: (row: PlayerRow) => ReactNode
  /** Buttons that belong beside the search box, e.g. "Yeni oyuncu". */
  toolbar?: ReactNode
  /** Anything between the toolbar and the table: an instruction on one screen,
   *  the error from a row action on the other. */
  notice?: ReactNode
}) {
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<AdminPlayerSort>('id')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [draft, setDraft] = useState(search)

  const players = useQuery({
    // `PER_PAGE` is part of the key on purpose. Both screens ask for the same
    // list, so leaving the page size out would let two mounts with different
    // sizes share one cache entry and show each other's rows.
    queryKey: ['players', search, page, PER_PAGE, sort, dir],
    queryFn: () => api.players({ q: search, page, perPage: PER_PAGE, sort, dir }),
  })

  // The page is state here while the filter is a prop, so a search started from
  // page 3 would otherwise ask for the fourth page of two results and land on
  // an empty table. The draft follows too, for the back button.
  useEffect(() => {
    setPage(0)
    setDraft(search)
  }, [search])

  const rows = players.data?.rows ?? []
  const total = players.data?.total ?? 0
  const lastPage = Math.max(0, Math.ceil(total / PER_PAGE) - 1)

  const sortBy = (key: AdminPlayerSort) => {
    if (key === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(key)
      setDir('asc')
    }
    setPage(0)
  }

  return (
    <div className="card">
      <div className="toolbar">
        {title && <h2>{title}</h2>}
        <span className="spacer" />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSearch(draft)
          }}
        >
          <input
            type="search"
            placeholder="Kullanıcı adı, e-posta veya ID"
            value={draft}
            style={{ width: 260 }}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
        <button onClick={() => onSearch(draft)}>Ara</button>
        {search !== '' && (
          <button
            onClick={() => {
              setDraft('')
              onSearch('')
            }}
          >
            Temizle
          </button>
        )}
        {toolbar}
      </div>

      {notice}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className="sortable"
                  onClick={() => sortBy(column.key)}
                  aria-sort={
                    sort === column.key
                      ? dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {column.label}
                  {sort === column.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th>E-posta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.login}</td>
                <td>{num(row.townCount)}</td>
                <td>{when(row.createdAt)}</td>
                <td>{when(row.lastVisitAt)}</td>
                <td>
                  <span className={row.banned ? 'badge banned' : 'badge'}>{banLabel(row)}</span>
                  {row.banned && row.blockedReason && <div className="hint">{row.blockedReason}</div>}
                </td>
                <td>{row.email}</td>
                <td className="actions">{actions(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {players.isLoading && <p className="loading">Yükleniyor…</p>}
        {!players.isLoading && rows.length === 0 && <p className="empty">Oyuncu bulunamadı.</p>}
      </div>

      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          ‹ Önceki
        </button>
        <span>
          Toplam {num(total)} oyuncu — sayfa {page + 1} / {lastPage + 1}
        </span>
        <button disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
          Sonraki ›
        </button>
      </div>
    </div>
  )
}
