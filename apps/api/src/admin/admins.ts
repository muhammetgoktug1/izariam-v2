/**
 * Panel-user CRUD.
 *
 * The one rule worth stating: the panel must never be able to lock itself out.
 * Deleting, disabling or demoting is refused when it would leave no active
 * super admin, and an admin cannot delete or disable themselves. Both checks
 * run *inside* the transaction that would do the damage, so there is no window
 * between the count and the write.
 */

import argon2 from 'argon2'

import { checkPassword, validEmail } from '../actions/register.js'
import type { Queryable } from '../state/load.js'
import { audit } from './audit.js'

export type AdminErrorCode =
  | 'invalid_email'
  | 'password_length'
  | 'name_required'
  | 'email_taken'
  | 'not_found'
  | 'self_delete'
  | 'self_disable'
  | 'last_super_admin'

/** Thrown, so the caller's transaction unwinds -- the same contract as
 *  `RegisterFailure`. */
export class AdminFailure extends Error {
  constructor(readonly code: AdminErrorCode) {
    super(code)
    this.name = 'AdminFailure'
  }
}

const CONFLICT_CODES: ReadonlySet<AdminErrorCode> = new Set([
  'email_taken',
  'self_delete',
  'self_disable',
  'last_super_admin',
])

export function adminFailureStatus(code: AdminErrorCode): 400 | 404 | 409 {
  if (code === 'not_found') return 404
  return CONFLICT_CODES.has(code) ? 409 : 400
}

export interface AdminRow {
  id: number
  email: string
  name: string
  role: string
  active: boolean
  createdAt: number
  lastLoginAt: number | null
}

function toRow(r: Record<string, unknown>): AdminRow {
  return {
    id: Number(r.id),
    email: String(r.email),
    name: String(r.name),
    role: String(r.role),
    active: Boolean(r.active),
    createdAt: Math.floor(new Date(r.created_at as string).getTime() / 1000),
    lastLoginAt: r.last_login_at
      ? Math.floor(new Date(r.last_login_at as string).getTime() / 1000)
      : null,
  }
}

export async function listAdmins(client: Queryable): Promise<AdminRow[]> {
  const { rows } = await client.query(
    `select id, email, name, role, active, created_at, last_login_at
       from admin_users order by id asc`,
    [],
  )
  return rows.map(toRow)
}

/** Postgres unique_violation -- the `lower(email)` index is what actually
 *  decides uniqueness, so a race lands here rather than in the pre-check. */
const UNIQUE_VIOLATION = '23505'

export async function createAdmin(
  client: Queryable,
  actor: { id: number; ip?: string | undefined },
  input: { email: string; name: string; password: string; active: boolean },
): Promise<number> {
  const email = input.email.trim()
  const name = input.name.trim()
  if (!validEmail(email)) throw new AdminFailure('invalid_email')
  if (name.length === 0) throw new AdminFailure('name_required')
  checkPassword(input.password)

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id })
  let id: number
  try {
    const { rows } = await client.query(
      `insert into admin_users (email, name, password_hash, role, active)
       values ($1, $2, $3, 'super_admin', $4) returning id`,
      [email, name, passwordHash, input.active],
    )
    id = Number(rows[0].id)
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new AdminFailure('email_taken')
    }
    throw err
  }

  await audit(client, {
    adminUserId: actor.id,
    action: 'admin.create',
    targetType: 'admin',
    targetId: id,
    meta: { email, active: input.active },
    ip: actor.ip,
  })
  return id
}

/**
 * Refuse anything that would leave the panel with no way in.
 *
 * Order matters, and it is the order the *message* should read in: losing the
 * last way into the panel is a worse problem than editing your own row, so when
 * both are true the answer says so. Reversed, an administrator who is the only
 * one left would be told "you cannot delete yourself", which sounds like a rule
 * they could get around by making a second account and deleting from there --
 * and they can, which is exactly the fix, but only the first message says it.
 *
 * `for update` locks the surviving rows for the rest of the transaction, so two
 * concurrent deletions cannot each see the other's row as the last one.
 */
async function assertNotLastWayIn(
  client: Queryable,
  targetId: number,
  actorId: number,
  onSelf: 'self_delete' | 'self_disable',
) {
  const { rows } = await client.query(
    `select id from admin_users
      where active and role = 'super_admin' and id <> $1 for update`,
    [targetId],
  )
  if (rows.length === 0) throw new AdminFailure('last_super_admin')
  if (targetId === actorId) throw new AdminFailure(onSelf)
}

export async function updateAdmin(
  client: Queryable,
  actor: { id: number; ip?: string | undefined },
  targetId: number,
  input: { email?: string; name?: string; password?: string; active?: boolean },
): Promise<void> {
  const { rows } = await client.query(
    'select id, active from admin_users where id = $1 for update',
    [targetId],
  )
  if (rows.length === 0) throw new AdminFailure('not_found')

  const sets: string[] = []
  const values: unknown[] = []
  const changed: string[] = []

  if (input.email !== undefined) {
    const email = input.email.trim()
    if (!validEmail(email)) throw new AdminFailure('invalid_email')
    values.push(email)
    sets.push(`email = $${values.length}`)
    changed.push('email')
  }
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (name.length === 0) throw new AdminFailure('name_required')
    values.push(name)
    sets.push(`name = $${values.length}`)
    changed.push('name')
  }
  // An empty password means "leave it alone" -- the edit form sends the field
  // whether or not it was filled in.
  if (input.password !== undefined && input.password !== '') {
    checkPassword(input.password)
    values.push(await argon2.hash(input.password, { type: argon2.argon2id }))
    sets.push(`password_hash = $${values.length}`)
    changed.push('password')
  }
  if (input.active !== undefined) {
    if (!input.active) await assertNotLastWayIn(client, targetId, actor.id, 'self_disable')
    values.push(input.active)
    sets.push(`active = $${values.length}`)
    changed.push('active')
  }

  if (sets.length === 0) return

  values.push(targetId)
  try {
    await client.query(
      `update admin_users set ${sets.join(', ')} where id = $${values.length}`,
      values,
    )
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new AdminFailure('email_taken')
    }
    throw err
  }

  // A new password, or a disabled account, must not leave live sessions behind.
  if (changed.includes('password') || input.active === false) {
    await client.query('delete from admin_sessions where admin_user_id = $1', [targetId])
  }

  await audit(client, {
    adminUserId: actor.id,
    action: 'admin.update',
    targetType: 'admin',
    targetId,
    meta: { changed },
    ip: actor.ip,
  })
}

export async function deleteAdmin(
  client: Queryable,
  actor: { id: number; ip?: string | undefined },
  targetId: number,
): Promise<void> {
  const { rows } = await client.query(
    'select id, email from admin_users where id = $1 for update',
    [targetId],
  )
  if (rows.length === 0) throw new AdminFailure('not_found')
  await assertNotLastWayIn(client, targetId, actor.id, 'self_delete')

  // The audit row is written first: `admin_audit_log.admin_user_id` is the
  // actor, not the target, so nothing here dangles -- and the target's id is
  // recorded as a plain number that outlives the row.
  await audit(client, {
    adminUserId: actor.id,
    action: 'admin.delete',
    targetType: 'admin',
    targetId,
    meta: { email: String(rows[0].email) },
    ip: actor.ip,
  })
  await client.query('delete from admin_users where id = $1', [targetId])
}
