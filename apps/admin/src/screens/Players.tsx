/**
 * Players: list, search, create, edit, ban.
 *
 * There is no delete, on purpose. A `users` row cascades through towns, army,
 * missions, messages and scores, and none of it comes back -- so the strongest
 * action here is a permanent ban, which is reversible.
 *
 * The table itself is `components/PlayerTable`, shared with the picker on the
 * resource screen; what stays here is everything a moderator can *do* to a row.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Field, Modal } from '../components/Modal.js'
import { PageHeader } from '../components/PageHeader.js'
import { PlayerTable } from '../components/PlayerTable.js'
import { api, type PlayerRow } from '../lib/api.js'
import { BAN_DURATIONS, errorText } from '../lib/format.js'
import { navigate } from '../lib/routes.js'

/** The game's origin, built from this page's so only the port differs. */
const GAME_ORIGIN = `${window.location.protocol}//${window.location.hostname}:5175`

interface NewPlayer {
  login: string
  email: string
  password: string
}

export function Players({ search }: { search: string }) {
  const queryClient = useQueryClient()

  const [creating, setCreating] = useState<NewPlayer | null>(null)
  const [editing, setEditing] = useState<PlayerRow | null>(null)
  const [banning, setBanning] = useState<PlayerRow | null>(null)
  const [resetToken, setResetToken] = useState<string | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['players'] })
  }

  const create = useMutation({
    mutationFn: (input: NewPlayer) => api.createPlayer(input),
    onSuccess: () => {
      refresh()
      setCreating(null)
    },
  })

  const edit = useMutation({
    mutationFn: (input: { id: number; login: string; email: string }) =>
      api.updatePlayer(input.id, { login: input.login, email: input.email }),
    onSuccess: () => {
      refresh()
      setEditing(null)
    },
  })

  const ban = useMutation({
    mutationFn: (input: { id: number; seconds: number | null; reason: string }) =>
      api.ban(input.id, {
        permanent: input.seconds === null,
        ...(input.seconds === null ? {} : { seconds: input.seconds }),
        reason: input.reason,
      }),
    onSuccess: () => {
      refresh()
      setBanning(null)
    },
  })

  const unban = useMutation({
    mutationFn: (id: number) => api.unban(id),
    onSuccess: refresh,
  })

  const resetLink = useMutation({
    mutationFn: (id: number) => api.resetLink(id),
    onSuccess: (data) => setResetToken(data.token),
  })

  return (
    <>
      <PageHeader title="Oyuncular" sub="Hesap açma, düzenleme ve moderasyon.">
        <button
          className="primary"
          onClick={() => setCreating({ login: '', email: '', password: '' })}
        >
          Yeni oyuncu
        </button>
      </PageHeader>
      <PlayerTable
        search={search}
        // The filter lives in the hash so a filtered list can be linked or
        // reloaded.
        onSearch={(value) => navigate('players', { q: value })}
        notice={
          (unban.isError || resetLink.isError) && (
            <p className="error">{errorText(unban.error ?? resetLink.error)}</p>
          )
        }
        actions={(row) => (
          <>
            <button onClick={() => setEditing(row)}>Düzenle</button>
            <button onClick={() => navigate('resources', { player: row.id, q: search })}>
              Kaynak ver
            </button>
            <button onClick={() => resetLink.mutate(row.id)}>Parola bağlantısı</button>
            {row.banned ? (
              <button onClick={() => unban.mutate(row.id)}>Yasağı kaldır</button>
            ) : (
              <button className="danger" onClick={() => setBanning(row)}>
                Yasakla
              </button>
            )}
          </>
        )}
      />

      {creating && (
        <Modal
          title="Yeni oyuncu hesabı"
          onClose={() => setCreating(null)}
          footer={
            <>
              <button onClick={() => setCreating(null)}>Vazgeç</button>
              <button
                className="primary"
                disabled={create.isPending}
                onClick={() => create.mutate(creating)}
              >
                Oluştur
              </button>
            </>
          }
        >
          <Field label="Kullanıcı adı" hint="3-30 karakter.">
            <input
              type="text"
              value={creating.login}
              onChange={(e) => setCreating({ ...creating, login: e.target.value })}
            />
          </Field>
          <Field label="E-posta">
            <input
              type="email"
              value={creating.email}
              onChange={(e) => setCreating({ ...creating, email: e.target.value })}
            />
          </Field>
          <Field label="Parola" hint="8-30 karakter.">
            <input
              type="password"
              value={creating.password}
              autoComplete="new-password"
              onChange={(e) => setCreating({ ...creating, password: e.target.value })}
            />
          </Field>
          <p className="hint">
            Hesap, oyuna kayıt olmuş gibi kurulur: haritada boş bir ada yeri, ilk şehir ve
            belediye binası dahil.
          </p>
          {create.isError && <p className="error">{errorText(create.error)}</p>}
        </Modal>
      )}

      {editing && (
        <Modal
          title={`${editing.login} — düzenle`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button onClick={() => setEditing(null)}>Vazgeç</button>
              <button
                className="primary"
                disabled={edit.isPending}
                onClick={() =>
                  edit.mutate({ id: editing.id, login: editing.login, email: editing.email })
                }
              >
                Kaydet
              </button>
            </>
          }
        >
          <Field label="Kullanıcı adı">
            <input
              type="text"
              value={editing.login}
              onChange={(e) => setEditing({ ...editing, login: e.target.value })}
            />
          </Field>
          <Field label="E-posta">
            <input
              type="email"
              value={editing.email}
              onChange={(e) => setEditing({ ...editing, email: e.target.value })}
            />
          </Field>
          <p className="hint">
            Parola buradan değiştirilemez: "Parola bağlantısı" düğmesi tek kullanımlık bir
            sıfırlama bileti üretir, böylece hesabın parolasını kimse öğrenmez.
          </p>
          {edit.isError && <p className="error">{errorText(edit.error)}</p>}
        </Modal>
      )}

      {banning && <BanDialog player={banning} onClose={() => setBanning(null)} mutation={ban} />}

      {resetToken && (
        <Modal
          title="Parola sıfırlama bağlantısı"
          onClose={() => setResetToken(null)}
          footer={<button onClick={() => setResetToken(null)}>Kapat</button>}
        >
          <p className="hint">
            Bir saat geçerli, tek kullanımlık. Oyuncuya iletin; kullanıldığında hesabın tüm
            oturumları kapanır.
          </p>
          <input type="text" readOnly value={`${GAME_ORIGIN}/#reset/${resetToken}`} />
        </Modal>
      )}
    </>
  )
}

/**
 * The ban dialog.
 *
 * It sends a duration in seconds, never a date. `blocked_until` is a
 * `timestamptz` compared against the server's clock; a zone-less date from a
 * Turkish-locale picker would be three hours out.
 */
function BanDialog({
  player,
  onClose,
  mutation,
}: {
  player: PlayerRow
  onClose: () => void
  mutation: {
    mutate: (input: { id: number; seconds: number | null; reason: string }) => void
    isPending: boolean
    isError: boolean
    error: unknown
  }
}) {
  const [seconds, setSeconds] = useState<number | null>(BAN_DURATIONS[0]!.seconds)
  const [reason, setReason] = useState('')

  return (
    <Modal
      title={`${player.login} — yasakla`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Vazgeç</button>
          <button
            className="danger"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ id: player.id, seconds, reason })}
          >
            Yasakla
          </button>
        </>
      }
    >
      <Field label="Süre">
        <select
          value={seconds === null ? 'permanent' : String(seconds)}
          onChange={(e) =>
            setSeconds(e.target.value === 'permanent' ? null : Number(e.target.value))
          }
        >
          {BAN_DURATIONS.map((option) => (
            <option
              key={option.label}
              value={option.seconds === null ? 'permanent' : String(option.seconds)}
            >
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Gerekçe" hint="Oyuncu giriş denemesinde bu metni görür.">
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p className="hint warn">Yasaklama, oyuncunun açık oturumlarını da hemen kapatır.</p>
      {mutation.isError && <p className="error">{errorText(mutation.error)}</p>}
    </Modal>
  )
}
