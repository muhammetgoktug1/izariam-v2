/**
 * The router and the wiring between the API graph and the chrome.
 *
 * Replaces the `Game` controller: one hash route per legacy page key, the same
 * three dispatch tables (`show_view`, `show_bread`, `show_sidebox`) driven from
 * lib/routes.ts, and the same document order inside the frame.
 *
 * What the first cut got wrong and this fixes:
 *
 * 1. It knew two page keys and silently rewrote the other 63 to `city`, so 15
 *    links in the toolbar, the advisors and the footer all led to the city.
 * 2. The page key drives both `document.body.id` and the per-page stylesheet,
 *    so it must be whatever is actually rendered. Setting it to
 *    `buildingGround` while still showing the city instantly unstyles the city,
 *    because every city rule is scoped `#city #container ...`.
 * 3. The game skin must not be applied to the login screen. The legacy start
 *    page is a separate document with a disjoint stylesheet set.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AppShell, type ChromeData } from './components/AppShell.js'
import { Breadcrumbs, type BreadContext } from './components/chrome/Breadcrumbs.js'
import { SideBoxes } from './components/chrome/SideBoxes.js'
import { NotesPanel } from './components/NotesPanel.js'
import { Tutorial } from './components/Tutorial.js'
import { ApiError, api, type StateResponse } from './lib/api.js'
import { getLocale, subscribeLocale, t } from './lib/i18n.js'
import { breadFor, hashFor, parseHash, sideboxesFor, type Route } from './lib/routes.js'
import { applyBodyId, applySkin, applyStartPageSkin, clearSkin } from './lib/skin.js'
import type { ScreenContext } from './screens/context.js'
import { screenFor } from './screens/registry.js'
import { StartPage } from './screens/StartPage.js'

export function App() {
  const queryClient = useQueryClient()
  const [route, setRoute] = useState<Route>(parseHash)
  const [townId, setTownId] = useState<number | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)

  // Every screen resolves its strings through t() at render time, so a locale
  // switch only has to re-render this tree -- subscribing here covers both the
  // game chrome and the logged-out start page.
  useSyncExternalStore(subscribeLocale, getLocale)

  useEffect(() => {
    const sync = () => setRoute(parseHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const navigate = useCallback((hash: string) => {
    setFailure(null)
    if (window.location.hash === hash) setRoute(parseHash(hash))
    else window.location.hash = hash
  }, [])

  const state = useQuery<StateResponse>({
    queryKey: ['state'],
    queryFn: api.state,
    retry: (_count, err) => !(err instanceof ApiError && err.status === 401),
    refetchOnWindowFocus: true,
  })

  const authenticated = !!state.data
  const unauthorised =
    state.isError && state.error instanceof ApiError && state.error.status === 401

  // The skin only belongs on the game screens. Applying it to the login page
  // would give it body#city plus the whole in-game cascade.
  useEffect(() => {
    if (!authenticated) {
      clearSkin()
      applyStartPageSkin()
      applyBodyId('')
      return
    }
    applySkin(route.page)
    applyBodyId(route.page)
  }, [authenticated, route.page])

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.clear(),
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['state'] })
  }, [queryClient])

  /**
   * Returns whether the action was accepted, so a caller that needs to move on
   * afterwards -- the construction menu closing itself, say -- can tell a
   * refusal from a success. Every existing call site ignores the value.
   */
  const act = useCallback(
    async (path: string, body: unknown = {}) => {
      setFailure(null)
      try {
        await api.action(path, body)
      } catch (err) {
        // The rules' own reason string, which every screen renders in place.
        setFailure(err instanceof ApiError ? err.body.error : String(err))
        return false
      }
      // Everything is refetched rather than patched: the tick runs on every
      // request, so a local guess about what changed is wrong the moment an
      // accrual or an arriving fleet lands in the same call.
      await queryClient.invalidateQueries({ queryKey: ['state'] })
      await queryClient.invalidateQueries({ queryKey: ['island'] })
      return true
    },
    [queryClient],
  )

  // Server time minus browser time. The legacy left this correction commented
  // out (game_index.php:830) and simply showed the player's own clock.
  const clockOffset = useMemo(
    () => (state.data ? state.data.now - Date.now() / 1000 : 0),
    [state.data],
  )

  if (unauthorised) return <StartPage onAuthenticated={refresh} />
  if (state.isError) return <p>{t('world_load_failed')}: {String(state.error)}</p>
  if (!state.data) return <p>{t('loading')}…</p>

  const { state: world, derived, chrome, now } = state.data
  // Only founded towns go in the switcher: derive() drops a colony still in
  // transit (its town hall is level 0 until the fleet lands), exactly as
  // Load_Player skipped it -- offering it would land on a town with no
  // derived state at all.
  const towns = world.towns.filter((t) => derived.towns[t.id])
  const current = towns.find((t) => t.id === (townId ?? world.user.currentTownId)) ?? towns[0]
  if (!current) return <p>{t('account_no_town')}</p>

  const townDerived = derived.towns[current.id]
  const island = world.islands[current.islandId]
  // derive() drops a town whose town hall is level 0 -- a colony still in
  // transit -- exactly as Load_Player did.
  if (!townDerived || !island) return <p>{t('no_town_state')}</p>

  const ctx: ScreenContext = {
    route,
    state: world,
    derived,
    chrome,
    town: current,
    townDerived,
    island,
    now,
    clockOffset,
    navigate,
    act,
    refresh,
    failure,
  }

  // Only the island's own trade good and wood actually accrue; the other three
  // arrive by trade, which the tick does not model as a rate.
  const rates = { wood: 0, wine: 0, marble: 0, crystal: 0, sulfur: 0 }
  rates.wood = townDerived.resourceProductionBonus
  const tradeKey = townDerived.tradeResource as keyof typeof rates
  if (tradeKey !== 'wood') {
    rates[tradeKey] = townDerived.tradegoodProductionBonus
  } else {
    // A wood island produces through both paths; the legacy adds them.
    rates.wood += townDerived.tradegoodProductionBonus
  }

  const chromeData: ChromeData = {
    ambrosia: world.user.ambrosia,
    gold: world.user.gold,
    freeTransports: chrome.transports.free,
    totalTransports: chrome.transports.total,
    towns: towns.map((t) => {
      const isl = world.islands[t.islandId]
      return {
        id: t.id,
        name: t.name,
        x: isl?.x ?? 0,
        y: isl?.y ?? 0,
        tradeResource: isl?.tradeResource ?? 0,
      }
    }),
    currentTownId: current.id,
    displayMode: world.user.options.citySelect,
    stock: current.resources,
    rates,
    capacity: townDerived.capacity,
    freePopulation: current.peoples,
    maxPopulation: townDerived.maxPeoples,
    actionPoints: current.actionPoints,
    maxActionPoints: chrome.towns[String(current.id)]?.maxActionPoints ?? 0,
    sampledAt: now,
    clockOffset,
    hasPremium: chrome.hasPremium,
    page: route.page,
    tradeResource: island.tradeResource,
    tradegoodRate: townDerived.tradegoodProductionBonus,
    // Only sell offers count: the tooltip's "Market:" line is stock that has
    // been taken out of the warehouse and put on the shelf.
    onSale: Object.fromEntries(
      (['wood', 'wine', 'marble', 'crystal', 'sulfur'] as const).map((r) => {
        const offer = current.branchOffice?.offers[r]
        return [r, offer && offer.direction === 1 ? offer.count : 0]
      }),
    ) as ChromeData['onSale'],
    // Research 2_3, wealth. Without it the four mined goods render disabled.
    hasWealth: (world.user.research.levels['2_3'] ?? 0) > 0,
    newTownMessages: chrome.newTownMessages,
    newUserMessages: chrome.newUserMessages,
    researchAvailable: chrome.researchAdvisor,
    version: VERSION,
  }

  const breadContext: BreadContext = {
    island: { id: island.id, name: island.name, x: island.x, y: island.y },
    town: { id: current.id, name: current.name },
    tradeResource: island.tradeResource,
  }

  const Screen = screenFor(route.page)

  return (
    <AppShell
      data={chromeData}
      breadcrumbs={
        <Breadcrumbs
          spec={breadFor(route.page, route.params)}
          context={breadContext}
          onNavigate={navigate}
        />
      }
      onSelectTown={(id) => {
        setTownId(id)
        navigate(hashFor('city'))
      }}
      onNavigate={navigate}
      onToggleNotes={() => setNotesOpen((v) => !v)}
      notes={
        notesOpen ? (
          <NotesPanel initial={chrome.notes} onClose={() => setNotesOpen(false)} />
        ) : undefined
      }
      tutorial={
        // The capital only, and never over the highscore.
        current.id === world.user.capitalTownId && route.page !== 'highscore' ? (
          <Tutorial
            state={world.user.tutorialStep}
            page={route.page}
            onNext={() => void act('tutorials', { action: 'next' })}
            onSkip={() => void act('skipTutorial')}
          />
        ) : undefined
      }
      onLogout={() => logout.mutate()}
    >
      <Screen ctx={ctx} sideboxes={<SideBoxes boxes={sideboxesFor(route.page)} ctx={ctx} />} />
    </AppShell>
  )
}

/** Stamped by Vite from package.json at build time; "dev" when unset. */
const VERSION = (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? 'dev'
