/**
 * Granting resources.
 *
 * Pick a player, tick the towns, fill the fields, confirm. Each field carries
 * its own mode -- `+ ekle` adds (a negative subtracts), `= tanımla` writes the
 * value as it stands -- and a field left empty is not sent at all, which is how
 * "leave this alone" is expressed.
 *
 * The preview under each cell calls the *same* `applyGrant` the server calls,
 * so the arrow is not a guess: what it shows is what will be written, warehouse
 * clamp included.
 */

import {
  GRANT_ACCOUNT_FIELDS,
  GRANT_RESOURCES,
  applyGrant,
  type AdminResourceGrantRequest,
  type GrantAccountField,
  type GrantField,
  type GrantResource,
} from '@izariam/shared/admin'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Field, Modal } from '../components/Modal.js'
import { PageHeader } from '../components/PageHeader.js'
import { api, type GrantResult, type PlayerResources, type TownStock } from '../lib/api.js'
import { GRANT_LABELS, errorText, num, qty, signed, when } from '../lib/format.js'
import { navigate } from '../lib/routes.js'

type Mode = 'add' | 'set'
interface FieldState {
  mode: Mode
  /** The raw text. Empty means "do not send this field at all". */
  text: string
}

/** The panel names a mission in Turkish; the kinds are the rules' own. */
const MISSION_KIND: Record<string, string> = {
  colonise: 'Kolonileşme',
  transport: 'Nakliye',
  buy: 'Satın alma',
  sell: 'Satış',
  attack: 'Saldırı',
  plunder: 'Yağma',
}

const MISSION_PHASE: Record<string, string> = {
  loading: 'Yükleniyor',
  outbound: 'Yolda',
  returning: 'Dönüyor',
}

/** "2 sa 14 dk (21:47)" -- remaining first, the wall clock it lands on. */
function until(target: number, now: number): string {
  const left = Math.max(0, Math.floor(target - now))
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  const s = left % 60
  const clock = new Date(target * 1000).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const text =
    h > 0 ? `${h} sa ${m} dk` : m > 0 ? `${m} dk ${s} sn` : `${s} sn`
  return `${text} (${clock})`
}

const EMPTY: FieldState = { mode: 'add', text: '' }

type TownForm = Record<GrantResource, FieldState>
type AccountForm = Record<GrantAccountField, FieldState>

const EMPTY_TOWN: TownForm = {
  wood: { ...EMPTY },
  wine: { ...EMPTY },
  marble: { ...EMPTY },
  crystal: { ...EMPTY },
  sulfur: { ...EMPTY },
}
const EMPTY_ACCOUNT: AccountForm = {
  gold: { ...EMPTY },
  ambrosia: { ...EMPTY },
  researchPoints: { ...EMPTY },
  transports: { ...EMPTY },
}

/** Only a whole number counts as filled. A lone `-` is somebody mid-typing. */
function parsed(state: FieldState): GrantField | null {
  if (!/^-?\d+$/.test(state.text)) return null
  return { mode: state.mode, value: Number(state.text) }
}

function filled<K extends string>(form: Record<K, FieldState>): [K, GrantField][] {
  return (Object.entries(form) as [K, FieldState][])
    .map(([key, state]) => [key, parsed(state)] as const)
    .filter((pair): pair is readonly [K, GrantField] => pair[1] !== null)
    .map(([key, field]) => [key, field])
}

export function Resources({ playerId, search }: { playerId: number | null; search: string }) {
  // The grant form has no picker of its own any more: it is always entered
  // from a player row. A `#/resources` without a player -- a stale bookmark,
  // a mangled hand-typed hash -- goes back to the list it belongs behind.
  useEffect(() => {
    if (playerId === null) navigate('players', { q: search })
  }, [playerId, search])

  return playerId === null ? null : <GrantForm playerId={playerId} search={search} />
}

function GrantForm({ playerId, search }: { playerId: number; search: string }) {
  const queryClient = useQueryClient()
  const stocks = useQuery({
    queryKey: ['playerResources', playerId],
    queryFn: () => api.playerResources(playerId),
  })

  const [selected, setSelected] = useState<number[]>([])
  const [town, setTown] = useState<TownForm>({ ...EMPTY_TOWN })
  const [account, setAccount] = useState<AccountForm>({ ...EMPTY_ACCOUNT })
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<GrantResult | null>(null)

  const data = stocks.data
  const towns = data?.towns ?? []
  const selectable = towns.filter((t) => t.active)

  // Default to every town the player actually has: the common case is "give
  // this account something", not "give this one town something".
  useEffect(() => {
    if (data) setSelected(data.towns.filter((t) => t.active).map((t) => t.id))
  }, [data])

  const townFields = filled(town)
  const accountFields = filled(account)
  const canSubmit =
    (townFields.length > 0 && selected.length > 0) || accountFields.length > 0

  const body: AdminResourceGrantRequest = {
    townIds: selected,
    town: Object.fromEntries(townFields) as AdminResourceGrantRequest['town'],
    account: Object.fromEntries(accountFields) as AdminResourceGrantRequest['account'],
    note,
  }

  const grant = useMutation({
    mutationFn: () => api.grantResources(playerId, body),
    onSuccess: (data) => {
      setResult(data)
      setConfirming(false)
      void queryClient.invalidateQueries({ queryKey: ['playerResources', playerId] })
      void queryClient.invalidateQueries({ queryKey: ['players'] })
    },
  })

  if (stocks.isPending)
    return (
      <>
        <PageHeader title="Kaynaklar" sub="Kaynak verilecek oyuncunun verileri yükleniyor." />
        <p className="loading">Yükleniyor…</p>
      </>
    )
  if (!data)
    return (
      <>
        <PageHeader title="Kaynaklar" />
        <p className="empty">Oyuncu bulunamadı.</p>
      </>
    )

  const reset = () => {
    setTown({ ...EMPTY_TOWN })
    setAccount({ ...EMPTY_ACCOUNT })
    setNote('')
  }

  return (
    <>
      <PageHeader
        title={data.player.login}
        sub={`#${data.player.id} · Son giriş: ${when(data.player.lastVisitAt)}`}
      >
        {/* Back to the player list the account was picked from, filter and all. */}
        <button onClick={() => navigate('players', { q: search })}>Listeye dön</button>
      </PageHeader>

      {data.missions.length > 0 && (
        <div className="card">
          <h2>Seferler</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Görev</th>
                  <th>Güzergâh</th>
                  <th>Durum</th>
                  <th className="num">Gemi</th>
                  <th>Sonraki olay</th>
                </tr>
              </thead>
              <tbody>
                {data.missions.map((mission) => (
                  <tr key={mission.id}>
                    <td>{MISSION_KIND[mission.kind] ?? mission.kind}</td>
                    <td>
                      {mission.fromName ?? '?'} → {mission.toName ?? '?'}
                    </td>
                    <td>
                      <span className={`badge ${mission.phase === 'loading' ? 'pending' : ''}`}>
                        {MISSION_PHASE[mission.phase]}
                      </span>
                    </td>
                    <td className="num">{mission.transports}</td>
                    <td>{mission.arrivesAt == null ? '—' : until(mission.arrivesAt, data.now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TownTable
        towns={towns}
        selected={selected}
        onSelect={setSelected}
        town={town}
        selectable={selectable}
      />

      <div className="card">
        <h2>Verilecek</h2>

        <h3>Şehir kaynakları</h3>
        <div className="grid">
          {GRANT_RESOURCES.map((r) => (
            <GrantFieldInput
              key={r}
              label={GRANT_LABELS[r]!}
              value={town[r]}
              onChange={(next) => setTown({ ...town, [r]: next })}
            />
          ))}
        </div>
        <p className="hint">
          Seçili {selected.length} şehre uygulanır. Depo sınırını aşan miktar kırpılır.
        </p>

        <h3>Hesap geneli</h3>
        <div className="grid">
          <GrantFieldInput
            label={GRANT_LABELS.gold!}
            hint="Sıralamadaki altın puanı da güncellenir."
            value={account.gold}
            onChange={(next) => setAccount({ ...account, gold: next })}
          />
          <GrantFieldInput
            label={GRANT_LABELS.ambrosia!}
            hint="Depo sınırı yok."
            value={account.ambrosia}
            onChange={(next) => setAccount({ ...account, ambrosia: next })}
          />
          <GrantFieldInput
            label={GRANT_LABELS.researchPoints!}
            hint="Depo sınırı yok."
            value={account.researchPoints}
            onChange={(next) => setAccount({ ...account, researchPoints: next })}
          />
          <GrantFieldInput
            label={GRANT_LABELS.transports!}
            hint={`Limandaki boş gemi. Yolda ${
              data.account.transports.total - data.account.transports.free
            } gemi daha var.`}
            value={account.transports}
            onChange={(next) => setAccount({ ...account, transports: next })}
          />
        </div>

        <Field label="Not" hint="Denetim kaydına yazılır, oyuncuya gösterilmez.">
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="toolbar">
          <span className="spacer" />
          <button onClick={reset}>Temizle</button>
          <button className="primary" disabled={!canSubmit} onClick={() => setConfirming(true)}>
            Ver
          </button>
        </div>
        {grant.isError && <p className="error">{errorText(grant.error)}</p>}
      </div>

      {confirming && (
        <ConfirmGrant
          player={data}
          towns={towns.filter((t) => selected.includes(t.id))}
          townFields={townFields}
          accountFields={accountFields}
          pending={grant.isPending}
          error={grant.isError ? errorText(grant.error) : null}
          onCancel={() => setConfirming(false)}
          onConfirm={() => grant.mutate()}
        />
      )}

      {result && (
        <GrantSummary
          result={result}
          onClose={() => {
            setResult(null)
            reset()
          }}
        />
      )}
    </>
  )
}

function TownTable({
  towns,
  selected,
  onSelect,
  town,
  selectable,
}: {
  towns: TownStock[]
  selected: number[]
  onSelect: (ids: number[]) => void
  town: TownForm
  selectable: TownStock[]
}) {
  const all = useRef<HTMLInputElement>(null)
  const every = selectable.length > 0 && selected.length === selectable.length
  const some = selected.length > 0 && !every

  useEffect(() => {
    // `indeterminate` is not an attribute; it only exists on the DOM node.
    if (all.current) all.current.indeterminate = some
  }, [some])

  const toggle = (id: number) =>
    onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  return (
    <div className="card">
      <div className="toolbar">
        <h2>Şehirler</h2>
        <span className="spacer" />
        <button onClick={() => onSelect(selectable.map((t) => t.id))}>Hepsi</button>
        <button onClick={() => onSelect([])}>Hiçbiri</button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  ref={all}
                  type="checkbox"
                  checked={every}
                  onChange={() => onSelect(every ? [] : selectable.map((t) => t.id))}
                />
              </th>
              <th>Şehir</th>
              <th>Koordinat</th>
              {GRANT_RESOURCES.map((r) => (
                <th key={r} className="num">
                  {GRANT_LABELS[r]}
                </th>
              ))}
              <th className="num">Depo sınırı</th>
            </tr>
          </thead>
          <tbody>
            {towns.map((t) => {
              const picked = selected.includes(t.id)
              return (
                <tr key={t.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={!t.active}
                      onChange={() => toggle(t.id)}
                    />
                  </td>
                  <td>
                    {t.name}
                    {!t.active && <span className="badge pending"> Kuruluyor</span>}
                    {t.rewoundBy > 0 && (
                      <div className="hint warn">
                        Bu şehre {Math.round(t.rewoundBy / 60)} dk. önce bir sefer indi; oyuncunun
                        bir sonraki isteğinde o aradaki üretim tekrar eklenir.
                      </div>
                    )}
                  </td>
                  <td>
                    [{t.x}:{t.y}]
                  </td>
                  {GRANT_RESOURCES.map((r) => {
                    const field = parsed(town[r])
                    const preview =
                      picked && field && t.capacity !== null
                        ? applyGrant(t.resources[r], field, t.capacity)
                        : null
                    return (
                      <td key={r} className="num">
                        {qty(t.resources[r])}
                        {preview && (
                          <div className={preview.clamped ? 'hint warn' : 'hint'}>
                            → {qty(preview.value)}
                            {preview.clamped ? ' (sınır)' : preview.floored ? ' (0)' : ''}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td className="num">{t.capacity === null ? '—' : qty(t.capacity)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {towns.length === 0 && <p className="empty">Bu hesabın şehri yok.</p>}
      </div>
    </div>
  )
}

function GrantFieldInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: FieldState
  onChange: (next: FieldState) => void
}) {
  const invalid = value.text !== '' && value.text !== '-' && !/^-?\d+$/.test(value.text)
  const negativeSet = value.mode === 'set' && value.text.startsWith('-')

  return (
    <div className="field">
      <label>{label}</label>
      <div className="grant-row">
        <select
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as Mode })}
        >
          <option value="add">+ ekle</option>
          <option value="set">= tanımla</option>
        </select>
        <input
          type="number"
          step="1"
          inputMode="numeric"
          placeholder="değiştirme"
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
        />
      </div>
      {invalid && <div className="hint error">Tam sayı girin.</div>}
      {negativeSet && <div className="hint error">= tanımla ile eksi değer verilemez.</div>}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function describe(entries: [string, GrantField][]): string[] {
  return entries.map(([key, f]) =>
    f.mode === 'set'
      ? `${GRANT_LABELS[key] ?? key} = ${num(f.value)}`
      : `${GRANT_LABELS[key] ?? key} ${signed(f.value)}`,
  )
}

function ConfirmGrant({
  player,
  towns,
  townFields,
  accountFields,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  player: PlayerResources
  towns: TownStock[]
  townFields: [GrantResource, GrantField][]
  accountFields: [GrantAccountField, GrantField][]
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  // The same arithmetic the server will run, so the warning is accurate.
  const willClamp = towns.filter((t) =>
    townFields.some(
      ([r, f]) => t.capacity !== null && applyGrant(t.resources[r], f, t.capacity).clamped,
    ),
  ).length

  return (
    <Modal
      title="Kaynak verilecek"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Vazgeç</button>
          <button className="primary" disabled={pending} onClick={onConfirm}>
            Onayla ve ver
          </button>
        </>
      }
    >
      <p>
        Oyuncu: <strong>{player.player.login}</strong> (#{player.player.id})
      </p>
      {townFields.length > 0 ? (
        <>
          <p className="hint">
            Şehirler ({towns.length}): {towns.map((t) => t.name).join(', ')}
          </p>
          <ul>
            {describe(townFields as [string, GrantField][]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="hint">Şehir kaynağı verilmiyor.</p>
      )}
      {accountFields.length > 0 && (
        <ul>
          {describe(accountFields as [string, GrantField][]).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {willClamp > 0 && (
        <p className="hint warn">
          {willClamp} şehirde depo sınırı aşılacak, fazlası verilmeyecek.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}

function GrantSummary({ result, onClose }: { result: GrantResult; onClose: () => void }) {
  const changed = GRANT_RESOURCES.filter((r) =>
    result.towns.some((t) => t.before[r] !== t.after[r]),
  )

  return (
    <Modal title="Sonuç" onClose={onClose} footer={<button onClick={onClose}>Kapat</button>}>
      <p className="notice">
        {result.towns.length} şehre uygulandı.
      </p>
      {result.clampedTowns > 0 && (
        <p className="warn">
          {result.clampedTowns} şehirde depo sınırına ulaşıldı, fazlası verilmedi.
        </p>
      )}
      {changed.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Şehir</th>
                {changed.map((r) => (
                  <th key={r} className="num">
                    {GRANT_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.towns.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  {changed.map((r) => (
                    <td key={r} className="num">
                      {qty(t.before[r])} → {qty(t.after[r])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul>
        {GRANT_ACCOUNT_FIELDS.map((key) => {
          const before =
            key === 'transports' ? result.account.before.transports.free : result.account.before[key]
          const after =
            key === 'transports' ? result.account.after.transports.free : result.account.after[key]
          if (before === after) return null
          return (
            <li key={key}>
              {GRANT_LABELS[key]}: {qty(before as number)} → {qty(after as number)}
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
