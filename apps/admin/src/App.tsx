/**
 * The shell: an auth gate, and five screens behind it.
 *
 * Authentication is decided by a status code, the same way the game decides it
 * -- `GET /api/admin/auth/me` answers 401 when there is no live panel session,
 * and that is the whole login check. Nothing is stored client-side; the session
 * lives in an httpOnly cookie scoped to /api/admin.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore, type ReactNode } from 'react'

import { Layout } from './components/Layout.js'
import { ApiError, api, type Admin } from './lib/api.js'
import { AdminUsers } from './screens/AdminUsers.js'
import { AuditLog } from './screens/AuditLog.js'
import { Login } from './screens/Login.js'
import { Players } from './screens/Players.js'
import { Resources } from './screens/Resources.js'
import { Summary } from './screens/Summary.js'
import {
  currentHash,
  parseHash,
  subscribeHash,
  type Page,
  type Route,
} from './lib/routes.js'

/**
 * One entry per Page, and the type says so: `Record<Page, ...>` makes a new
 * screen a compile error rather than a silent fall-through to whatever the
 * default arm used to be.
 *
 * Each screen takes plain strings, never `route.params` itself -- a fresh
 * `URLSearchParams` stringifies to `"{}"`, so two different filter sets would
 * hash to the same React Query key and the screen would show a stale result.
 */
const SCREENS: Record<Page, (route: Route, admin: Admin) => ReactNode> = {
  summary: () => <Summary />,
  players: (route) => <Players search={route.params.get('q') ?? ''} />,
  resources: (route) => (
    <Resources
      playerId={Number(route.params.get('player')) || null}
      search={route.params.get('q') ?? ''}
    />
  ),
  admins: (_route, admin) => <AdminUsers currentAdminId={admin.id} />,
  audit: (route) => (
    <AuditLog
      action={route.params.get('action') ?? ''}
      adminId={route.params.get('admin') ?? ''}
      targetId={route.params.get('target') ?? ''}
      targetType={route.params.get('type') ?? ''}
      from={route.params.get('from') ?? ''}
      to={route.params.get('to') ?? ''}
    />
  ),
}

export function App() {
  const queryClient = useQueryClient()
  const hash = useSyncExternalStore(subscribeHash, currentHash)
  const route = parseHash(hash)

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })

  const logout = useMutation({
    mutationFn: api.logout,
    // Clear everything: the next admin at this desk must not see the previous
    // one's cached lists.
    onSettled: () => queryClient.clear(),
  })

  if (me.isPending) return null

  const unauthorised = me.isError && me.error instanceof ApiError && me.error.status !== 500
  if (unauthorised || !me.data) {
    return <Login onAuthenticated={() => queryClient.invalidateQueries({ queryKey: ['me'] })} />
  }

  return (
    <Layout admin={me.data.admin} page={route.page} onLogout={() => logout.mutate()}>
      {SCREENS[route.page](route, me.data.admin)}
    </Layout>
  )
}
