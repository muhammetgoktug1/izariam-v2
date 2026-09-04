/**
 * What every screen is handed.
 *
 * The legacy gave its views the whole `$this` -- Player_Model, Data_Model,
 * Island_Model, the language file and the config, all as ambient globals. This
 * is the same set of facts, passed explicitly, so a screen's dependencies are
 * visible in its signature instead of discoverable only by reading it.
 *
 * `state` is the graph exactly as the rules engine sees it, which is what lets
 * screens call `buildingCost` and friends and get the number the server will
 * validate against.
 */

import type {
  DerivedPlayer,
  DerivedTown,
  IslandState,
  PlayerState,
  TownState,
} from '@izariam/rules'
import type { ComponentType, ReactNode } from 'react'

import type { ChromeResponse } from '../lib/api.js'
import type { Route } from '../lib/routes.js'

export interface ScreenContext {
  route: Route
  state: PlayerState
  derived: DerivedPlayer
  chrome: ChromeResponse
  /** The selected town, and its derived stats. Always present: App refuses to
   *  render the game at all for an account with no active town. */
  town: TownState
  townDerived: DerivedTown
  island: IslandState
  /** Server time when the graph was sampled, and server-minus-client drift. */
  now: number
  clockOffset: number

  navigate: (hash: string) => void
  /** POST an action and refetch the graph. Rejects with the rules' reason. */
  /** Resolves `true` when the rules accepted the action, `false` on a refusal
   *  (the reason lands in `failure`). Most callers ignore it. */
  act: (path: string, body?: unknown) => Promise<boolean>
  refresh: () => void
  /** Reason string from the last refused action, for screens that show one. */
  failure: string | null
}

export interface ScreenProps {
  ctx: ScreenContext
  /**
   * The sideboxes `sideboxesFor()` picked for this page, already rendered.
   *
   * Screens render this themselves rather than having the shell do it, because
   * the legacy emits sideboxes and the main view as siblings in that order
   * (game_index.php:333-334) and a few screens need to interleave: the island
   * board drives `#information` and `#actions` off whichever town was clicked,
   * which in the legacy was JavaScript cloning DOM nodes across the page.
   */
  sideboxes: ReactNode
}

/**
 * A screen is a component, not a plain render function: several of them fetch
 * (island, highscore, mail) or hold selection state, and hooks need a
 * component to live in.
 */
export type Screen = ComponentType<ScreenProps>
