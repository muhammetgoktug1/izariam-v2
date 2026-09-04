/**
 * The logged-out start page, reproducing izariam/views/main_index_4.php.
 *
 * A completely separate document from the game: its own stylesheet chain
 * (css/style.css -> gf_reset + gf_default + layout.css, plus
 * defaultStartpageTemplate.css) and none of the in-game skin. The first cut
 * of this client rendered a bare `#loginBox`, an id that appears in no
 * stylesheet in the repo, on top of the *game* cascade -- hence the unstyled
 * form on a stone background.
 *
 * The id/class tree below is the contract. `layout.css` positions everything
 * absolutely off these ids: `#page{width:795px}`, `#loginWrapper{display:none}`
 * until the Login button reveals it (main_index_4.php:277), `.input-wrap` for
 * the underlined field rows, `#major` for the character art, and the `#sky`
 * parallax layers whose rules live inline in the PHP and so are reproduced
 * here.
 *
 * Dropped from the legacy: the Flash trailer, Facebook Connect, OpenID, and
 * RSA.js client-side "encryption" of a password the server stored as plain
 * md5. All four were dead scaffolding.
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { ApiError, api } from '../lib/api.js'
import { t, tf } from '../lib/i18n.js'
import { LanguageSwitch } from '../components/chrome/LanguageSwitch.js'

interface Props {
  onAuthenticated: () => void
}

/** API error codes -> catalog keys; resolved through t() at render time so the
 *  message follows the active language.
 *
 *  Every code the auth routes can return has an entry. It did not always: the
 *  request schema used to reject a short password or a malformed address with
 *  a generic `invalid_input`, which fell through this map and printed the code
 *  itself on the page. The rules now live in one place server-side and answer
 *  with the specific code, but `invalid_input` stays mapped as a backstop. */
const ERROR_KEYS: Record<string, string> = {
  name_length: 'error_name_length',
  password_length: 'error_password_length',
  invalid_email: 'error_email2',
  name_taken: 'error_name',
  world_full: 'error_world_text_2',
  bad_credentials: 'error_login_password',
  account_blocked: 'error_blocked',
  invalid_token: 'error_reset_token',
  invalid_input: 'error_input',
}

/** The sky parallax rules live in a <style> block in main_index_4.php:187-193,
 *  not in any .css file, so they have to travel with the component. */
const SKY_STYLES = `
#sky{height:265px;position:absolute;top:0;z-index:2;overflow:hidden;width:100%}
#sky #baloon{background:url(/img/bg_balloon.png) no-repeat 95% 0;height:100%;width:120%;position:absolute;top:0;z-index:7}
#sky #clouds-1{background:url('/img/pt_clouds.png') repeat-x 0 0;width:110%;height:100%;position:absolute;top:0;z-index:5}
#sky #clouds-2{background:url('/img/pt_clouds.png') repeat-x 0 -265px;width:120%;height:100%;position:absolute;top:0;z-index:4}
#sky #clouds-3{background:url('/img/pt_clouds.png') repeat-x 0 -530px;width:130%;height:100%;position:absolute;top:0;z-index:3}
#sky #birds{background:url(/img/pt-birds.png) repeat-x;width:120%;height:100%;position:absolute;top:0;z-index:6}
`

/**
 * views/main/password.php -- ask for a reset by email address.
 *
 * Same id/class tree as the legacy (`#passwordLost`, `#pwLost`, `#pwLostForm`,
 * `#emailPasswordLost`), so the start page stylesheet positions it unchanged.
 * What is behind it is not the same: the legacy generated an eight-character
 * password, wrote it to the account and mailed the plaintext
 * (izariam/controllers/main.php:206-251); this asks for a one-shot token and
 * changes nothing until that token comes back.
 */
function ForgotForm({
  email,
  onEmail,
  onSubmit,
  onBack,
  pending,
  devToken,
}: {
  email: string
  onEmail: (v: string) => void
  onSubmit: () => void
  onBack: () => void
  pending: boolean
  devToken?: string
}) {
  return (
    <div id="passwordLost">
      <h2>{t('link_lost_text')}</h2>
      <div id="pwLost">
        <form
          id="pwLostForm"
          method="post"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <div className="input-wrap">
            <label htmlFor="serverPasswordLost">{t('world')}</label>
            <select name="universe" id="serverPasswordLost" defaultValue="alpha">
              <option className="inUse" value="alpha">
                Alpha
              </option>
            </select>
          </div>
          <div className="input-wrap">
            <label htmlFor="emailPasswordLost">{t('email')}</label>
            <input
              id="emailPasswordLost"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => onEmail(e.target.value)}
            />
          </div>
          <button type="submit" id="formSubmit" className="btn-login btn-big" disabled={pending}>
            {t('send')}
          </button>
          <br className="clearfloat" />
          <div className="button-wrap">
            <a
              id="pwLostBack"
              className="login-lnk back"
              href="#"
              onClick={(e) => {
                e.preventDefault()
                onBack()
              }}
            >
              {t('back')}
            </a>
          </div>
        </form>
      </div>
      {devToken && (
        <div id="pwLostInfo">
          <h4>{t('reset_dev_link')}</h4>
          <p>
            <a href={`#reset/${encodeURIComponent(devToken)}`}>{`#reset/${devToken}`}</a>
          </p>
        </div>
      )}
    </div>
  )
}

/** The second half of the reset, which the legacy had no equivalent for: it
 *  chose the new password itself and mailed it. */
function ResetForm({
  password,
  onPassword,
  onSubmit,
  pending,
}: {
  password: string
  onPassword: (v: string) => void
  onSubmit: () => void
  pending: boolean
}) {
  return (
    <div id="passwordLost">
      <h2>{t('new_password')}</h2>
      <div id="pwLost">
        <form
          id="pwResetForm"
          method="post"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <div className="input-wrap">
            <label htmlFor="resetPassword">{t('new_password')}</label>
            <input
              id="resetPassword"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => onPassword(e.target.value)}
            />
          </div>
          <button type="submit" id="formSubmit" className="btn-login btn-big" disabled={pending}>
            {t('change_password')}
          </button>
        </form>
      </div>
      <div id="pwLostInfo">
        <p>{t('password_safety')}</p>
      </div>
    </div>
  )
}

/** `#reset/<token>` -- where the reset mail's link would land. */
function resetTokenFromHash(): string | null {
  const m = window.location.hash.match(/^#reset\/(.+)$/)
  return m ? decodeURIComponent(m[1]!) : null
}

export function StartPage({ onAuthenticated }: Props) {
  const [loginOpen, setLoginOpen] = useState(false)
  const [login, setLogin] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [regName, setRegName] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [acceptedRules, setAcceptedRules] = useState(false)

  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetToken, setResetToken] = useState(() => resetTokenFromHash() ?? '')
  const [resetPassword, setResetPassword] = useState('')

  const doLogin = useMutation({
    mutationFn: () => api.login({ login, password: loginPassword }),
    onSuccess: onAuthenticated,
  })

  const doRegister = useMutation({
    mutationFn: () => api.register({ login: regName, password: regPassword, email: regEmail }),
    onSuccess: onAuthenticated,
  })

  const doForgot = useMutation({
    mutationFn: () => api.forgotPassword({ email: forgotEmail }),
  })

  const doReset = useMutation({
    mutationFn: () => api.resetPassword({ token: resetToken, password: resetPassword }),
    onSuccess: () => {
      window.location.hash = ''
      setResetToken('')
      setLoginOpen(true)
    },
  })

  /**
   * One form's failure must not linger over another's. Reading
   * `doLogin.error ?? doRegister.error` left a stale login failure sitting on
   * the page while the register form reported nothing at all, so clearing the
   * others is part of submitting.
   */
  const submit = (which: 'login' | 'register' | 'forgot' | 'reset') => {
    const all = { login: doLogin, register: doRegister, forgot: doForgot, reset: doReset }
    for (const [key, mutation] of Object.entries(all)) {
      if (key !== which) mutation.reset()
    }
    all[which].mutate()
  }

  const failure = doLogin.error ?? doRegister.error ?? doForgot.error ?? doReset.error
  const message = (() => {
    if (!failure) return null
    if (!(failure instanceof ApiError)) return String(failure)
    const code = failure.body.error
    if (code === 'account_blocked') {
      // The legacy composed this line in PHP with the date and the moderator's
      // note (izariam/models/player_model.php:271).
      const body = failure.body as { until?: number; reason?: string | null }
      const when = body.until ? new Date(body.until * 1000).toLocaleString() : ''
      return [tf('error_blocked', when), body.reason].filter(Boolean).join(' — ')
    }
    return ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : code
  })()

  // Not the legacy's `success_password` ("a randomly generated password has
  // been sent"), which describes what this no longer does.
  const notice = doForgot.isSuccess
    ? t('success_password_reset')
    : doReset.isSuccess
      ? t('success_password_changed')
      : null

  return (
    <>
      <style>{SKY_STYLES}</style>

      <div className="products" />

      <div id="wrapper">
        <div id="page">
          <div id="header">
            <div
              style={{ position: 'absolute', left: 10, top: 8, zIndex: 400, fontSize: 11 }}
            >
              <LanguageSwitch />
            </div>
            <a
              id="btn-login"
              className="btn-login desktopOnly"
              href="#login"
              title={t('login')}
              onClick={(e) => {
                e.preventDefault()
                setLoginOpen((v) => !v)
              }}
            >
              {t('login')}
            </a>

            <div id="loginWrapper" style={loginOpen ? { display: 'block' } : undefined}>
              <div className="boxTop" />
              <div className="boxMiddle" id="login">
                <form
                  id="loginForm"
                  method="post"
                  onSubmit={(e) => {
                    e.preventDefault()
                    submit('login')
                  }}
                >
                  <div className="input-wrap">
                    <label htmlFor="logServer">{t('world')}</label>
                    <select name="universe" id="logServer" defaultValue="alpha">
                      <option className="inUse" value="alpha">
                        Alpha
                      </option>
                    </select>
                  </div>
                  <div className="input-wrap">
                    <label htmlFor="loginName">{t('username')}</label>
                    <input
                      id="loginName"
                      name="name"
                      type="text"
                      autoComplete="username"
                      value={login}
                      onChange={(e) => setLogin(e.target.value)}
                    />
                  </div>
                  <div className="input-wrap">
                    <label htmlFor="loginPassword">{t('password')}</label>
                    <input
                      id="loginPassword"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                    />
                  </div>
                  <button type="submit" id="loginBtn" className="btn-login btn-big">
                    {t('login')}
                  </button>
                  {/* main_index_4.php:353 -- the link that swaps the content
                      pane for the password-lost form. */}
                  <div className="button-wrap">
                    <a
                      id="pwLost"
                      className="login-lnk"
                      href="#lost-password"
                      title={t('link_lost_text')}
                      onClick={(e) => {
                        e.preventDefault()
                        doLogin.reset()
                        setForgotOpen(true)
                      }}
                    >
                      {t('link_lost_text')}
                    </a>
                  </div>
                  <div className="acceptAgbWithLogin">
                    {t('accept_terms_1')} <a href="#terms">{t('accept_terms_link')}</a>
                    {t('accept_terms_2')}
                  </div>
                </form>
              </div>
              <div className="boxBottom" />
            </div>

            <h2 id="logo">
              <a id="logoimg" href="#/">
                iZariam
              </a>
            </h2>
          </div>

          <div id="container">
            <div id="sidebarWrapper">
              <div id="sidebarTop" />
              <div id="sidebar" className="clearfix">
                <img src="/img/blank.gif" id="major" width="233" height="228" alt="" />

                <div id="registerWrapper" className="clearfix">
                  <div id="registerTop" />
                  <div id="register">
                    <h1>{t('register_free')}</h1>
                    <form
                      id="registerForm"
                      method="post"
                      onSubmit={(e) => {
                        e.preventDefault()
                        submit('register')
                      }}
                    >
                      <div className="input-wrap">
                        <label htmlFor="registerName">{t('username')}</label>
                        <input
                          id="registerName"
                          name="name"
                          type="text"
                          autoComplete="username"
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                        />
                      </div>
                      <div className="input-wrap">
                        <label htmlFor="password">{t('password')}</label>
                        <input
                          id="password"
                          name="password"
                          type="password"
                          autoComplete="new-password"
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                        />
                      </div>
                      <div className="input-wrap">
                        <label htmlFor="email">{t('email')}</label>
                        <input
                          id="email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                        />
                      </div>
                      <div className="input-wrap">
                        <label htmlFor="registerServer">{t('world')}</label>
                        <select name="universe" id="registerServer" defaultValue="alpha">
                          <option value="alpha">Alpha</option>
                        </select>
                      </div>
                      <div className="input-wrap noBG">
                        <input
                          id="agb"
                          name="agb"
                          type="checkbox"
                          checked={acceptedRules}
                          onChange={(e) => setAcceptedRules(e.target.checked)}
                        />
                        <label htmlFor="agb">{t('register_accept')}</label>
                      </div>
                      {/* main_index_4.php:429 -- an <input type="submit">
                          with class reg-btn, not a <button>, and the skin
                          selects it as `form#registerForm div .reg-btn`
                          (layout.css:200), so the wrapping div matters. */}
                      <div>
                        <input
                          type="submit"
                          id="regBtn"
                          className="reg-btn"
                          value={t('register_button')}
                          disabled={!acceptedRules || doRegister.isPending}
                        />
                      </div>
                    </form>
                  </div>
                  <div id="registerBottom" />
                </div>
              </div>
              <div id="sidebarBottom" />
            </div>

            <div id="content">
              <div id="contentTop">
                <div id="menuBox">
                  <div className="lnkmenu" />
                  <ul id="menu" className="clearfix">
                    <li>
                      <a id="tab1" className="current" href="#home">
                        {t('link_home_text')}
                      </a>
                    </li>
                    <li>
                      <a id="tab2" href="#tour">
                        {t('link_tour_text')}
                      </a>
                    </li>
                    <li>
                      <a id="tab3" href="#media">
                        {t('link_media_text')}
                      </a>
                    </li>
                    <li>
                      <a id="tab4" href="#rules">
                        {t('rules')}
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
              <div id="contentMiddle" className="clearfix">
                <div id="pageContentWrapper">
                  <div id="pageContentTop" />
                  <div id="pageContent" className="page-content clearfix">
                    {resetToken ? (
                      <ResetForm
                        password={resetPassword}
                        onPassword={setResetPassword}
                        onSubmit={() => submit('reset')}
                        pending={doReset.isPending}
                      />
                    ) : forgotOpen ? (
                      <ForgotForm
                        email={forgotEmail}
                        onEmail={setForgotEmail}
                        onSubmit={() => submit('forgot')}
                        onBack={() => {
                          doForgot.reset()
                          setForgotOpen(false)
                        }}
                        pending={doForgot.isPending}
                        /* No mail transport in this stack, so the API hands the
                           token back outside production and the link is shown
                           here instead of being sent. */
                        devToken={doForgot.data?.token}
                      />
                    ) : (
                      <>
                        <h2>{t('welcome_title')}</h2>
                        <p>{t('welcome_text')}</p>
                      </>
                    )}
                    {notice && (
                      <p role="status" className="success">
                        {notice}
                      </p>
                    )}
                    {message && (
                      <p role="alert" className="error">
                        {message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div id="contentBottom" />
            </div>
          </div>
        </div>

        <div id="sky">
          <div id="clouds-1" />
          <div id="clouds-2" />
          <div id="clouds-3" />
          <div id="birds" />
          <div id="baloon" />
        </div>

        <div id="island-left" className="islands" />
        <div id="island-right" className="islands" />

        <div id="ship-1" className="ship" />
        <div id="ship-2" className="ship" />
        <div id="submarine" className="ship" />
      </div>

      <div id="footer-wrapper">
        <div id="footer">
          <div id="footer-inner">
            <div id="footer-menu" className="clearfix" />
          </div>
        </div>
      </div>
    </>
  )
}
