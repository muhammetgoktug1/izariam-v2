/**
 * Turkish formatting helpers.
 *
 * The panel has no i18n layer -- it is Turkish-only, so the locale is a
 * constant rather than a setting.
 */

import type { PlayerRow } from './api.js'

const dateTime = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
const numbers = new Intl.NumberFormat('tr-TR')

/** Epoch seconds -> "15.08.2026 20:13", or a dash for null. */
export function when(epochSeconds: number | null): string {
  if (!epochSeconds) return '—'
  return dateTime.format(new Date(epochSeconds * 1000))
}

export function num(value: number): string {
  return numbers.format(value)
}

/** A game quantity. Floored first, like the game's own `num()`
 *  (apps/web/src/lib/i18n.ts:884): the columns are numeric(20,6) and accrue
 *  fractions every second, so 1499,238412 is noise on a moderation screen. */
export function qty(value: number): string {
  return numbers.format(Math.floor(value))
}

/** `+10.000` / `-500`, for a delta the staff member typed. */
export function signed(value: number): string {
  return value >= 0 ? `+${num(value)}` : num(value)
}

/** The game's own words for everything the resource screen can grant. */
export const GRANT_LABELS: Record<string, string> = {
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

/** The three states a player's account can be in. */
export function banLabel(row: PlayerRow): string {
  if (!row.banned) return 'Aktif'
  if (row.permanentBan) return 'Kalıcı yasak'
  return `Yasaklı — ${when(row.blockedUntil)}`
}

/** Ban durations the dialog offers, in seconds. `null` means permanent. */
export const BAN_DURATIONS: { label: string; seconds: number | null }[] = [
  { label: '1 saat', seconds: 60 * 60 },
  { label: '6 saat', seconds: 6 * 60 * 60 },
  { label: '1 gün', seconds: 24 * 60 * 60 },
  { label: '3 gün', seconds: 3 * 24 * 60 * 60 },
  { label: '7 gün', seconds: 7 * 24 * 60 * 60 },
  { label: '30 gün', seconds: 30 * 24 * 60 * 60 },
  { label: 'Süresiz', seconds: null },
]

/**
 * Error codes the API answers with, in Turkish.
 *
 * Everything the panel can provoke is here; an unknown code falls back to a
 * generic line rather than printing the raw code at the user.
 */
const MESSAGES: Record<string, string> = {
  bad_credentials: 'E-posta veya parola hatalı.',
  too_many_attempts: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.',
  not_authenticated: 'Oturum açmanız gerekiyor.',
  session_expired: 'Oturumunuz sona erdi, tekrar giriş yapın.',
  account_disabled: 'Bu hesap devre dışı bırakılmış.',
  forbidden: 'Bu işlem için yetkiniz yok.',
  bad_origin: 'İstek beklenmeyen bir adresten geldi.',
  csrf_failed: 'Oturum doğrulaması başarısız, sayfayı yenileyin.',
  invalid_input: 'Girilen bilgiler geçersiz.',
  invalid_email: 'E-posta adresi geçersiz.',
  name_required: 'Ad boş bırakılamaz.',
  password_length: 'Parola 8 ile 30 karakter arasında olmalı.',
  email_taken: 'Bu e-posta adresi zaten kayıtlı.',
  name_taken: 'Bu kullanıcı adı zaten alınmış.',
  name_length: 'Kullanıcı adı 3 ile 30 karakter arasında olmalı.',
  world_full: 'Haritada boş yer kalmadı, yeni hesap açılamıyor.',
  not_found: 'Kayıt bulunamadı.',
  self_delete: 'Kendi hesabınızı silemezsiniz.',
  self_disable: 'Kendi hesabınızı devre dışı bırakamazsınız.',
  last_super_admin: 'Son süper yönetici silinemez veya kapatılamaz.',
  unknown_town: 'Seçilen şehirlerden biri bu oyuncuya ait değil.',
  town_not_active: 'Seçilen şehir henüz kurulmadı; kaynak verilemez.',
  no_towns_selected: 'Şehir kaynağı için en az bir şehir seçin.',
  nothing_to_do: 'Hiçbir alan doldurulmadı.',
  internal_error: 'Beklenmeyen bir hata oluştu.',
}

export function errorText(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'body' in error
      ? String((error as { body: { error?: string } }).body?.error ?? '')
      : ''
  return MESSAGES[code] ?? 'İşlem tamamlanamadı.'
}
