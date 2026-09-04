/**
 * Who did what from the panel.
 *
 * Written with the same client as the change it describes, so a rolled-back
 * transaction takes its log line with it and a committed one can never be
 * missing its entry.
 *
 * `listAudit` below is the reader behind the panel's Denetim kaydı screen. The
 * writer shipped a release earlier than the reader on purpose: retrofitting the
 * log would have meant revisiting every handler, and the history it would have
 * held by then is not recoverable.
 */

import type { AdminAuditListRequest } from '@izariam/shared/admin'

import type { Queryable } from '../state/load.js'

export interface AuditEntry {
  adminUserId: number
  action: string
  targetType: 'player' | 'admin'
  targetId?: number | null
  /** Anything worth knowing later. Never a password, never a token. */
  meta?: Record<string, unknown>
  ip?: string | undefined
}

export async function audit(client: Queryable, entry: AuditEntry): Promise<void> {
  await client.query(
    `insert into admin_audit_log (admin_user_id, action, target_type, target_id, meta, ip_address)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      entry.adminUserId,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      JSON.stringify(entry.meta ?? {}),
      entry.ip ?? null,
    ],
  )
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface AuditRow {
  id: number
  /** Epoch seconds, like every other instant this API hands the panel. */
  createdAt: number
  action: string
  targetType: string
  targetId: number | null
  /** The target's login or address as it stands now; null once the account is
   *  gone. Display only -- `targetId` is the fact. */
  targetLabel: string | null
  /** Parsed here rather than in the browser: the panel has no error boundary,
   *  so a corrupt row would blank the whole screen mid-render. */
  meta: Record<string, unknown> | null
  ip: string | null
  /** Null when the acting account has since been deleted -- `admin_user_id` is
   *  `on delete set null`, and the row is still the record of what happened. */
  admin: { id: number; email: string; name: string } | null
}

export interface AuditPage {
  rows: AuditRow[]
  total: number
  page: number
  perPage: number
}

/**
 * The filter, written once.
 *
 * Shared by the page query and its count, because six conditions copy-pasted
 * into two statements is six chances for the pager to disagree with the table.
 */
const AUDIT_FILTER = `
      ($1::text   = ''  or l.action        = $1::text)
  and ($2::text   = ''  or l.target_type   = $2::text)
  and ($3::int    = 0   or l.admin_user_id = $3::int)
  and ($4::int    = 0   or l.target_id     = $4::int)
  and ($5::bigint = 0   or l.created_at >= to_timestamp($5::bigint))
  and ($6::bigint = 0   or l.created_at <  to_timestamp($6::bigint))`

function parseMeta(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    // `audit()` always writes JSON.stringify(...), so this means somebody has
    // been in the table by hand. The rest of the row is still worth showing.
    return null
  }
}

function toRow(r: Record<string, unknown>): AuditRow {
  return {
    id: Number(r.id),
    createdAt: Math.floor(new Date(r.created_at as string).getTime() / 1000),
    action: String(r.action),
    targetType: String(r.target_type),
    targetId: r.target_id == null ? null : Number(r.target_id),
    targetLabel: (r.target_label as string | null) ?? null,
    meta: parseMeta(r.meta),
    ip: (r.ip_address as string | null) ?? null,
    admin:
      r.admin_id == null
        ? null
        : { id: Number(r.admin_id), email: String(r.admin_email), name: String(r.admin_name) },
  }
}

export async function listAudit(
  client: Queryable,
  input: AdminAuditListRequest,
): Promise<AuditPage> {
  const params = [
    input.action,
    input.targetType,
    input.adminId,
    input.targetId,
    input.from,
    input.to,
  ]

  const { rows } = await client.query(
    `select l.id, l.created_at, l.action, l.target_type, l.target_id, l.meta, l.ip_address,
            a.id as admin_id, a.email as admin_email, a.name as admin_name,
            -- Two more joins, because which table target_id points at depends
            -- on target_type and there is no foreign key on it at all.
            coalesce(pu.login, ta.email) as target_label,
            count(*) over()::int         as total
       from admin_audit_log l
       -- LEFT, and it matters: a deleted admin's rows have a null actor, and an
       -- inner join would hide exactly the history this table exists to keep.
       left join admin_users a  on a.id = l.admin_user_id
       left join users       pu on l.target_type = 'player' and pu.id = l.target_id
       left join admin_users ta on l.target_type = 'admin'  and ta.id = l.target_id
      where ${AUDIT_FILTER}
      -- id, not created_at: now() is transaction time, so two rows written in
      -- one transaction are equal to the microsecond and offset paging would
      -- show one of them twice and the other never.
      order by l.id desc
      limit $7 offset $8`,
    [...params, input.perPage, input.page * input.perPage],
  )

  return {
    rows: rows.map(toRow),
    // `count(*) over()` has no row to ride on when the page is empty, and
    // without the fallback the pager would claim "sayfa 1 / 1" on page 3.
    total: rows.length > 0 ? Number(rows[0].total) : await countAudit(client, params),
    page: input.page,
    perPage: input.perPage,
  }
}

async function countAudit(client: Queryable, params: unknown[]): Promise<number> {
  const { rows } = await client.query(
    `select count(*)::int as total from admin_audit_log l where ${AUDIT_FILTER}`,
    params,
  )
  return Number(rows[0]?.total ?? 0)
}
