/**
 * Who did what, newest first.
 *
 * No sortable headers: an activity log has one useful order. Filters are drafts
 * applied by a button rather than on every change -- writing the hash on each
 * `<select>` click would push a history entry per click and make the back
 * button useless.
 */

import type { AdminAuditAction } from '@izariam/shared/admin'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '../components/PageHeader.js'
import { api, type AuditRow } from '../lib/api.js'
import { AUDIT_ACTIONS, TARGET_TYPES, actionLabel, auditDetail } from '../lib/audit.js'
import { num, when } from '../lib/format.js'
import { hashFor, navigate } from '../lib/routes.js'

const PER_PAGE = 25

interface Props {
  action: string
  adminId: string
  targetId: string
  targetType: string
  from: string
  to: string
}

/**
 * `<input type="date">` gives `YYYY-MM-DD`, and `new Date('2026-08-15')` parses
 * that as *UTC* midnight -- three hours early in Istanbul, and the API
 * container runs in UTC while the browser does not. Building the date from its
 * parts pins it to the browser's own midnight, which is the day boundary the
 * person reading the table means.
 */
function dayStart(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return 0
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000)
}

/** Exclusive: the upper bound is the next midnight, or "bitiş = bugün" would
 *  return nothing that happened today. */
function dayEnd(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return 0
  return Math.floor(new Date(y, m - 1, d + 1).getTime() / 1000)
}

export function AuditLog({ action, adminId, targetId, targetType, from, to }: Props) {
  const [page, setPage] = useState(0)
  const [draft, setDraft] = useState({ action, adminId, targetId, targetType, from, to })

  const admins = useQuery({ queryKey: ['admins'], queryFn: api.admins })

  // The hash is user input: a value that is not one of ours becomes "no filter"
  // rather than a 400 the person cannot act on.
  const knownAction = action in AUDIT_ACTIONS ? (action as AdminAuditAction) : ''
  const knownTarget = targetType === 'player' || targetType === 'admin' ? targetType : ''

  const log = useQuery({
    // Primitives only: a URLSearchParams in a query key hashes to "{}".
    queryKey: ['audit', action, adminId, targetId, targetType, from, to, page],
    queryFn: () =>
      api.audit({
        action: knownAction,
        targetType: knownTarget,
        adminId: Number(adminId) || 0,
        targetId: Number(targetId) || 0,
        from: dayStart(from),
        to: dayEnd(to),
        page,
        perPage: PER_PAGE,
      }),
  })

  const apply = () => {
    setPage(0)
    navigate('audit', {
      action: draft.action,
      admin: draft.adminId,
      target: draft.targetId,
      type: draft.targetType,
      from: draft.from,
      to: draft.to,
    })
  }

  const clear = () => {
    setDraft({ action: '', adminId: '', targetId: '', targetType: '', from: '', to: '' })
    setPage(0)
    navigate('audit')
  }

  const rows = log.data?.rows ?? []
  const total = log.data?.total ?? 0
  const lastPage = Math.max(0, Math.ceil(total / PER_PAGE) - 1)

  return (
    <>
      <PageHeader title="Denetim kaydı" sub="Panelde yapılan her işlemin izi." />
      <div className="card">
        <div className="toolbar">
          <span className="spacer" />
        <select
          value={draft.action}
          style={{ width: 220 }}
          onChange={(e) => setDraft({ ...draft, action: e.target.value })}
        >
          <option value="">Tüm işlemler</option>
          {Object.entries(AUDIT_ACTIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={draft.adminId}
          style={{ width: 200 }}
          onChange={(e) => setDraft({ ...draft, adminId: e.target.value })}
        >
          <option value="">Tüm yöneticiler</option>
          {(admins.data?.rows ?? []).map((row) => (
            <option key={row.id} value={String(row.id)}>
              {row.name || row.email}
            </option>
          ))}
        </select>
        <select
          value={draft.targetType}
          style={{ width: 130 }}
          onChange={(e) => setDraft({ ...draft, targetType: e.target.value })}
        >
          <option value="">Tüm hedefler</option>
          <option value="player">Oyuncu</option>
          <option value="admin">Yönetici</option>
        </select>
        <input
          type="number"
          placeholder="Hedef ID"
          style={{ width: 110 }}
          value={draft.targetId}
          onChange={(e) => setDraft({ ...draft, targetId: e.target.value })}
        />
        <input
          type="date"
          style={{ width: 150 }}
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
        <input
          type="date"
          style={{ width: 150 }}
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
        />
        <button className="primary" onClick={apply}>
          Uygula
        </button>
        <button onClick={clear}>Temizle</button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Zaman</th>
              <th>Yönetici</th>
              <th>İşlem</th>
              <th>Hedef</th>
              <th>Ayrıntı</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: AuditRow) => (
              <tr key={row.id}>
                <td>{when(row.createdAt)}</td>
                <td>
                  {row.admin ? (
                    row.admin.name || row.admin.email
                  ) : (
                    // `admin_user_id` is `on delete set null`, so this is not a
                    // bug: the actor's account is gone, the record is not.
                    <span className="badge off">silinmiş yönetici</span>
                  )}
                </td>
                <td>{actionLabel(row.action)}</td>
                <td>
                  {TARGET_TYPES[row.targetType] ?? row.targetType}{' '}
                  {row.targetType === 'player' && row.targetLabel ? (
                    <a href={hashFor('players', { q: row.targetLabel })}>{row.targetLabel}</a>
                  ) : (
                    (row.targetLabel ?? '—')
                  )}
                  {row.targetId ? ` #${row.targetId}` : ''}
                </td>
                <td className="detail">{auditDetail(row.action, row.meta)}</td>
                <td>{row.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.isLoading && <p className="loading">Yükleniyor…</p>}
        {!log.isLoading && rows.length === 0 && <p className="empty">Kayıt bulunamadı.</p>}
      </div>

      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          ‹ Önceki
        </button>
        <span>
          Toplam {num(total)} kayıt — sayfa {page + 1} / {lastPage + 1}
        </span>
        <button disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
          Sonraki ›
        </button>
        </div>
      </div>
    </>
  )
}
