/**
 * The audit log, in Turkish.
 *
 * The label map is typed against the shared enum, so an action added to the
 * contract cannot ship without a label -- the panel does not compile until it
 * has one. Lookups still fall back to the raw string, because a row written
 * before an action was renamed must render as something.
 */

import type { AdminAuditAction } from '@izariam/shared/admin'

import { num, qty, when } from './format.js'

export const AUDIT_ACTIONS: Record<AdminAuditAction, string> = {
  'admin.create': 'Yönetici eklendi',
  'admin.update': 'Yönetici güncellendi',
  'admin.delete': 'Yönetici silindi',
  'player.create': 'Oyuncu hesabı açıldı',
  'player.update': 'Oyuncu bilgileri güncellendi',
  'player.ban': 'Oyuncu yasaklandı',
  'player.unban': 'Yasak kaldırıldı',
  'player.reset_link': 'Parola sıfırlama bağlantısı üretildi',
  'player.grant_resources': 'Kaynak verildi',
}

export function actionLabel(action: string): string {
  return AUDIT_ACTIONS[action as AdminAuditAction] ?? action
}

export const TARGET_TYPES: Record<string, string> = {
  player: 'Oyuncu',
  admin: 'Yönetici',
}

/** The field names `updateAdmin()` / `updatePlayer()` put in `meta.changed`. */
const FIELDS: Record<string, string> = {
  login: 'kullanıcı adı',
  email: 'e-posta',
  name: 'ad',
  password: 'parola',
  active: 'durum',
}

const GRANT_FIELDS: Record<string, string> = {
  wood: 'İnşaat malzemesi',
  wine: 'Şarap',
  marble: 'Mermer',
  crystal: 'Kristal Cam',
  sulfur: 'Sülfür',
  gold: 'Altın',
  ambrosia: 'Ambrosia',
  researchPoints: 'Araştırma Puanı',
  transports: 'Ticaret gemileri',
}

function text(meta: Record<string, unknown>, key: string): string {
  return typeof meta[key] === 'string' ? (meta[key] as string) : ''
}

/** `{ wood: { mode: 'add', value: 10000 } }` -> `İnşaat malzemesi +10.000`. */
function grantSummary(fields: unknown): string[] {
  if (typeof fields !== 'object' || fields === null) return []
  return Object.entries(fields as Record<string, unknown>).map(([key, raw]) => {
    const f = raw as { mode?: string; value?: number }
    const label = GRANT_FIELDS[key] ?? key
    const value = Number(f?.value ?? 0)
    return f?.mode === 'set'
      ? `${label} = ${qty(value)}`
      : `${label} ${value >= 0 ? '+' : ''}${num(value)}`
  })
}

/**
 * `meta` as a sentence.
 *
 * One case per action whose shape is worth reading, and a generic
 * "anahtar: değer" fallback for the rest -- so an action added by another
 * screen is legible the day it lands, before anyone writes a case for it.
 */
export function auditDetail(action: string, meta: Record<string, unknown> | null): string {
  if (!meta || Object.keys(meta).length === 0) return '—'

  switch (action) {
    case 'player.ban': {
      const until = Date.parse(text(meta, 'until'))
      const parts: string[] = [
        meta.permanent === true
          ? 'Kalıcı'
          : `${when(Number.isNaN(until) ? null : Math.floor(until / 1000))} tarihine kadar`,
      ]
      if (text(meta, 'reason')) parts.push(`“${text(meta, 'reason')}”`)
      const revoked = Number(meta.sessionsRevoked ?? 0)
      if (revoked > 0) parts.push(`${num(revoked)} oturum kapatıldı`)
      return parts.join(' — ')
    }
    case 'player.grant_resources': {
      const parts = [...grantSummary(meta.town), ...grantSummary(meta.account)]
      const townIds = Array.isArray(meta.townIds) ? meta.townIds : []
      if (townIds.length > 0) parts.unshift(`${townIds.length} şehir`)
      const clamped = Number(meta.clampedTowns ?? 0)
      if (clamped > 0) parts.push(`${clamped} şehirde depo sınırı`)
      if (text(meta, 'note')) parts.push(`“${text(meta, 'note')}”`)
      return parts.join(' · ') || '—'
    }
    case 'player.update':
    case 'admin.update': {
      const changed = Array.isArray(meta.changed) ? meta.changed : []
      if (changed.length === 0) return '—'
      return `Değişen: ${changed.map((f) => FIELDS[String(f)] ?? String(f)).join(', ')}`
    }
    case 'player.create':
      return text(meta, 'login') ? `Kullanıcı adı: ${text(meta, 'login')}` : '—'
    case 'admin.create':
      return (
        [text(meta, 'email'), meta.active === false ? 'devre dışı' : '']
          .filter(Boolean)
          .join(' — ') || '—'
      )
    case 'admin.delete':
      return text(meta, 'email') || '—'
    default:
      return Object.entries(meta)
        .map(([k, v]) => `${k}: ${v === null ? '—' : String(v)}`)
        .join(' · ')
  }
}
