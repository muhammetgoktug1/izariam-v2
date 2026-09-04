/**
 * The panel's landing numbers.
 *
 * One endpoint rather than one per tile: `main.tsx` sets `staleTime: 0` and
 * `refetchOnMount: 'always'`, so every visit to the tab refetches everything --
 * six endpoints would mean six round trips through the dev proxy and six
 * loading states to reconcile, for six integers.
 */

import { listAudit, type AuditRow } from './audit.js'
import type { Queryable } from '../state/load.js'

export interface AdminSummary {
  counts: {
    players: number
    banned: number
    newWeek: number
    newDay: number
    online: number
    towns: number
    admins: number
    adminsActive: number
    openSessions: number
    actionsDay: number
  }
  recent: AuditRow[]
  top: { id: number; login: string; value: number }[]
}

export async function getSummary(client: Queryable): Promise<AdminSummary> {
  const players = await client.query(
    `select
       count(*)::int as players,
       -- The same "an elapsed ban is not a ban" rule the player list uses;
       -- written any other way the two screens disagree about the same account.
       count(*) filter (where blocked_until is not null and blocked_until > now())::int as banned,
       count(*) filter (where created_at >= now() - interval '7 days')::int             as new_week,
       count(*) filter (where created_at >= now() - interval '24 hours')::int           as new_day,
       -- "Online" is recent activity, not a valid cookie: a session lives seven
       -- days, so counting live sessions would report a fortnight of players as
       -- present. last_visit_at is written by every persisted tick.
       count(*) filter (where last_visit_at >= now() - interval '15 minutes')::int      as online
     from users`,
    [],
  )

  const rest = await client.query(
    `select
       (select count(*)::int from towns)                                            as towns,
       (select count(*)::int from admin_users)                                      as admins,
       (select count(*)::int from admin_users where active)                         as admins_active,
       -- Distinct: one player with a phone and a laptop is one player.
       (select count(distinct user_id)::int from sessions where expires_at > now()) as open_sessions,
       (select count(*)::int from admin_audit_log
         where created_at >= now() - interval '24 hours')                           as actions_day`,
    [],
  )

  const top = await client.query(
    // `user_scores_rank_idx` is on (category, value desc) for exactly this.
    `select u.id, u.login, s.value
       from user_scores s join users u on u.id = s.user_id
      where s.category = 'total'
      order by s.value desc
      limit 5`,
    [],
  )

  const recent = await listAudit(client, {
    action: '',
    targetType: '',
    adminId: 0,
    targetId: 0,
    from: 0,
    to: 0,
    page: 0,
    perPage: 8,
  })

  const p = players.rows[0] ?? {}
  const r = rest.rows[0] ?? {}

  return {
    counts: {
      players: Number(p.players ?? 0),
      banned: Number(p.banned ?? 0),
      newWeek: Number(p.new_week ?? 0),
      newDay: Number(p.new_day ?? 0),
      online: Number(p.online ?? 0),
      towns: Number(r.towns ?? 0),
      admins: Number(r.admins ?? 0),
      adminsActive: Number(r.admins_active ?? 0),
      openSessions: Number(r.open_sessions ?? 0),
      actionsDay: Number(r.actions_day ?? 0),
    },
    recent: recent.rows,
    top: top.rows.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      login: String(row.login),
      value: Number(row.value),
    })),
  }
}
