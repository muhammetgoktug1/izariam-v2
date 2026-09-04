import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { Field } from '../components/Modal.js'
import { api } from '../lib/api.js'
import { errorText } from '../lib/format.js'

/** The same pediment mark the rail carries, scaled up for the door. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5 12 3.5l8.5 5"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4 20h16" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The panel's front door.
 *
 * Every rejection the server can give -- wrong password, disabled account, a
 * role that may not sign in -- comes back as the same `bad_credentials`, so
 * there is nothing here to distinguish either.
 */
export function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => api.login({ email, password }),
    onSuccess: onAuthenticated,
  })

  return (
    <div className="login-wrap">
      <div className="login">
        <div className="card">
          <div className="brand">
            <span className="mark">
              <Mark />
            </span>
            <h1>iZariam Yönetim Paneli</h1>
          </div>
          <p className="sub">Devam etmek için yönetici hesabınızla giriş yapın.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              login.mutate()
            }}
          >
            <Field label="E-posta">
              <input
                type="email"
                value={email}
                autoComplete="username"
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Parola">
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <button className="primary" type="submit" disabled={login.isPending}>
              {login.isPending ? 'Giriş yapılıyor…' : 'Giriş yap'}
            </button>
            {login.isError && <p className="error">{errorText(login.error)}</p>}
          </form>
        </div>
      </div>
    </div>
  )
}
