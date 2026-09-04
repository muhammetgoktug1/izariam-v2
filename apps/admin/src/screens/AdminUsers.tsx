/**
 * Panel users.
 *
 * The server refuses to let the panel lock itself out -- no deleting or
 * disabling the last active super admin, and no deleting or disabling yourself
 * -- so this screen only has to show the resulting message.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Field, Modal } from '../components/Modal.js'
import { PageHeader } from '../components/PageHeader.js'
import { api, type AdminRow } from '../lib/api.js'
import { errorText, when } from '../lib/format.js'

interface FormState {
  id: number | null
  email: string
  name: string
  password: string
  active: boolean
}

const EMPTY: FormState = { id: null, email: '', name: '', password: '', active: true }

export function AdminUsers({ currentAdminId }: { currentAdminId: number }) {
  const queryClient = useQueryClient()
  const admins = useQuery({ queryKey: ['admins'], queryFn: api.admins })

  const [form, setForm] = useState<FormState | null>(null)
  const [confirming, setConfirming] = useState<AdminRow | null>(null)

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['admins'] })
    setForm(null)
    setConfirming(null)
  }

  // One mutation for both, so the form does not need two error paths. The
  // return values differ ({id} vs {ok}), and neither is used.
  const save = useMutation<unknown, unknown, FormState>({
    mutationFn: (state: FormState) =>
      state.id === null
        ? api.createAdmin({
            email: state.email,
            name: state.name,
            password: state.password,
            active: state.active,
          })
        : api.updateAdmin(state.id, {
            email: state.email,
            name: state.name,
            active: state.active,
            // An empty box means "leave the password alone"; the server treats
            // it the same way.
            ...(state.password === '' ? {} : { password: state.password }),
          }),
    onSuccess: done,
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteAdmin(id),
    onSuccess: done,
  })

  const rows = admins.data?.rows ?? []

  return (
    <>
      <PageHeader title="Yöneticiler" sub="Panel hesapları, rolleri ve durumları.">
        <button className="primary" onClick={() => setForm({ ...EMPTY })}>
          Yeni yönetici
        </button>
      </PageHeader>
      <div className="card">
        <div className="toolbar">
          <span className="spacer" />
        </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>E-posta</th>
              <th>Ad</th>
              <th>Rol</th>
              <th>Durum</th>
              <th>Oluşturulma</th>
              <th>Son giriş</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.email}</td>
                <td>{row.name}</td>
                <td>{row.role === 'super_admin' ? 'Süper yönetici' : row.role}</td>
                <td>
                  <span className={row.active ? 'badge' : 'badge off'}>
                    {row.active ? 'Aktif' : 'Devre dışı'}
                  </span>
                </td>
                <td>{when(row.createdAt)}</td>
                <td>{when(row.lastLoginAt)}</td>
                <td className="actions">
                  <button
                    onClick={() =>
                      setForm({
                        id: row.id,
                        email: row.email,
                        name: row.name,
                        password: '',
                        active: row.active,
                      })
                    }
                  >
                    Düzenle
                  </button>
                  <button
                    className="danger"
                    disabled={row.id === currentAdminId}
                    title={
                      row.id === currentAdminId ? 'Kendi hesabınızı silemezsiniz' : undefined
                    }
                    onClick={() => setConfirming(row)}
                  >
                    Sil
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admins.isLoading && <p className="loading">Yükleniyor…</p>}
        {!admins.isLoading && rows.length === 0 && <p className="empty">Kayıt yok.</p>}
      </div>

      {form && (
        <Modal
          title={form.id === null ? 'Yeni yönetici' : 'Yöneticiyi düzenle'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button onClick={() => setForm(null)}>Vazgeç</button>
              <button
                className="primary"
                disabled={save.isPending}
                onClick={() => save.mutate(form)}
              >
                Kaydet
              </button>
            </>
          }
        >
          <Field label="E-posta">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Ad">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field
            label="Parola"
            hint={
              form.id === null
                ? '8-30 karakter.'
                : 'Boş bırakılırsa parola değişmez. Değiştirilirse o hesabın açık oturumları kapanır.'
            }
          >
            <input
              type="password"
              value={form.password}
              autoComplete="new-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Durum">
            <select
              value={form.active ? 'active' : 'inactive'}
              onChange={(e) => setForm({ ...form, active: e.target.value === 'active' })}
            >
              <option value="active">Aktif</option>
              <option value="inactive">Devre dışı</option>
            </select>
          </Field>
          {save.isError && <p className="error">{errorText(save.error)}</p>}
        </Modal>
      )}

      {confirming && (
        <Modal
          title="Yöneticiyi sil"
          onClose={() => setConfirming(null)}
          footer={
            <>
              <button onClick={() => setConfirming(null)}>Vazgeç</button>
              <button
                className="danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(confirming.id)}
              >
                Sil
              </button>
            </>
          }
        >
          <p>
            <strong>{confirming.email}</strong> hesabı silinecek. Bu işlem geri alınamaz.
          </p>
          {remove.isError && <p className="error">{errorText(remove.error)}</p>}
        </Modal>
      )}
      </div>
    </>
  )
}
