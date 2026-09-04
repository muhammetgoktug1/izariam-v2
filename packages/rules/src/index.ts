/**
 * The public surface of the rules engine.
 *
 * `export *` cannot be used for the action modules: four of them declare their
 * own `ActionContext` (each takes a different shape -- building and military
 * want the town and its derived stats, trade wants an id allocator, colony
 * wants neither) and two declare a different `SpyTargetTown`
 * (military.ts:335 is what the send-spy form needs, espionage.ts:83 is what the
 * risk calculation needs). Re-exporting them by name here would collapse six
 * distinct types into two wrong ones.
 *
 * So the root exports everything that does not collide, and the colliding
 * names stay reachable through the subpaths declared in package.json:
 *
 *   import type { ActionContext } from '@izariam/rules/actions/building'
 *
 * Before this file listed them, the entire action layer, the espionage model,
 * the mission loop and the trade-route scheduler were unreachable from the API
 * package -- written, tested, and impossible to call.
 */

export * from './config.js'
export * from './costs.js'
export * from './derive.js'
export * from './hurry.js'
export * from './temple.js'
export * from './tick.js'
export * from './types.js'

export {
  activateMiracle,
  type MiracleInput,
  type MiracleContext,
} from './actions/miracle.js'

export {
  donateWonder,
  type WonderIsland,
  type WonderDonationInput,
  type WonderDonationResult,
} from './actions/wonder.js'

export {
  build,
  upgrade,
  hurryConstruction,
  demolition,
  abortBuildings,
  leaveConstructionList,
  workers,
  resources,
  tavern,
  type HurryMode,
  type WorkersInput,
} from './actions/building.js'

export {
  army,
  fleet,
  armyEdit,
  abortShips,
  abortUnits,
  spyes,
  type MilitaryFailure,
  type UnitCounts,
  type SpyOrder,
} from './actions/military.js'

export {
  AMBROSIA_PER_EXTRA_ROUTE,
  emptyBranchOffice,
  maxBranchSearchRadius,
  branchOffice,
  trade,
  routeTime,
  tradeRoute,
  transport,
  totalTransports,
  transporter,
  abortFleet,
  maxActionPoints,
  type BranchOfficeParams,
  type TradeParams,
  type TradeRouteParams,
  type TransportParams,
  type AbortFleetParams,
} from './actions/trade.js'

export {
  colonize,
  RELOCATE_AMBROSIA_COST,
  PREMIUM_COST,
  PREMIUM_DURATION,
  abolishColony,
  changeCapital,
  doResearch,
  buyPremium,
  renameLogin,
  changePassword,
  setCitySelectMode,
  skipTutorial,
  renameTown,
  tutorials,
  sendUserMessage,
  deleteUserMessages,
  readUserMessage,
  type ActionError,
  type RelocateInput,
  type FoundColonyInput,
  type ColonizeInput,
  type TutorialAction,
  type UserMessage,
  type Mailbox,
} from './actions/colony.js'

export {
  phpRandInt,
  targetDefences,
  riskFromDefences,
  SPY_MISSION,
  tickSpies,
  createSpiesHook,
  ESPIONAGE_MISSION,
  resolveEspionage,
  // The espionage shape, not military's. The send-spy form's version is
  // reachable at '@izariam/rules/actions/military'.
  type SpyTargetTown,
  type SlotBuilding,
  type SpyTickOptions,
  type EspionageMission,
  type EspionageIntel,
  type UnitCount,
  type ResearchBranchIntel,
  type EspionageReport,
  type EspionageRejection,
  type EspionageOutcome,
  type EspionageRequest,
  type EspionageResult,
} from './espionage.js'

export { tickTradeRoutes } from './traderoutes.js'

export {
  defaultMissionWorld,
  missionTiming,
  projectArrival,
  tickMissions,
  type MissionTown,
  type MissionUser,
  type MissionWorld,
  type MissionTiming,
} from './missions.js'
