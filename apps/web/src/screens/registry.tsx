/**
 * Page key -> screen component.
 *
 * The legacy's `show_view` switch (view_model.php:201-269) had 65 cases and one
 * `default` that rendered `view/null`. This is the same dispatch; anything not
 * listed falls to the error screen, which is what `view/null` amounted to.
 *
 * Several keys deliberately share a component, because the legacy files are
 * byte-for-byte the same body with different tokens:
 *
 * - `armyGarrisonEdit` / `fleetGarrisonEdit` -- one file, line for line.
 * - `palace` / `palaceColony` -- same body.
 * - `resource` / `tradegood` -- same body, different island node.
 * - `diplomacyAdvisor` / `diplomacyAdvisorOutBox` -- same table, other box.
 * - `barracks` / `shipyard` -- same shape, land units versus ships.
 * - `pedia` / `informations` -- same 1,622-line body, different topic offset.
 * - the five workshops -- one component, four tokens.
 */

import type { Page } from '../lib/routes.js'
import { AcademyScreen } from './Academy.js'
import {
  CombatReportsArchiveScreen,
  CombatReportsScreen,
  DiplomacyAdvisorScreen,
  DiplomacyOutboxScreen,
  MerchantNavyScreen,
  MilitaryMovementsScreen,
  TradeAdvisorScreen,
} from './Advisors.js'
import { BuildingGroundScreen } from './BuildingGround.js'
import { CarpenteringScreen } from './Carpentering.js'
import { CityScreen } from './City.js'
import type { Screen } from './context.js'
import {
  AbolishColonyScreen,
  DemolitionScreen,
  RenameCityScreen,
  SendMessageScreen,
} from './Confirmations.js'
import { ErrorScreen } from './Error.js'
import { FinancesScreen } from './Finances.js'
import { HighscoreScreen } from './Highscore.js'
import { GarrisonEditScreen } from './GarrisonEdit.js'
import { IslandScreen } from './Island.js'
import { ResourceScreen, TradegoodScreen } from './IslandNode.js'
import {
  CityMilitaryScreen,
  DeletionConfirmScreen,
  OptionsScreen,
  PlunderScreen,
  PremiumDetailsScreen,
  PremiumPaymentScreen,
  PremiumScreen,
  PremiumTradeAdvisorScreen,
  TradeRouteScreen,
} from './Misc.js'
import { PalaceScreen } from './Palace.js'
import { InformationsScreen, PediaScreen } from './Pedia.js'
import { PortScreen, SafehouseReportsScreen, SafehouseScreen } from './PortSafehouse.js'
import { BarracksScreen, ShipyardScreen } from './Recruit.js'
import {
  BranchOfficeScreen,
  ColonizeScreen,
  TakeOfferScreen,
  TransportScreen,
} from './Trade.js'
import {
  BuildingDetailScreen,
  CreditsScreen,
  VersionScreen,
  WonderDetailScreen,
} from './Reference.js'
import {
  ResearchAdvisorScreen,
  ResearchDetailScreen,
  ResearchOverviewScreen,
} from './Research.js'
import { SafehouseMissionsScreen, SendSpyScreen } from './Safehouse.js'
import { TavernScreen } from './Tavern.js'
import { TownHallScreen } from './TownHall.js'
import { WallScreen } from './Wall.js'
import { WarehouseScreen } from './Warehouse.js'
import { WorkshopScreen } from './Workshop.js'
import { TempleScreen } from './Temple.js'
import { WonderScreen } from './Wonder.js'
import { WorldMapScreen } from './WorldMap.js'

export const SCREENS: Partial<Record<Page, Screen>> = {
  city: CityScreen,
  island: IslandScreen,
  worldmap_iso: WorldMapScreen,
  error: ErrorScreen,

  // Wave 1: BuildingHeader + UpgradePanel + one table.
  forester: WorkshopScreen,
  stonemason: WorkshopScreen,
  glassblowing: WorkshopScreen,
  winegrower: WorkshopScreen,
  alchemist: WorkshopScreen,
  wall: WallScreen,
  palace: PalaceScreen,
  palaceColony: PalaceScreen,
  carpentering: CarpenteringScreen,
  warehouse: WarehouseScreen,
  townHall: TownHallScreen,

  // Wave 2: one form or slider each.
  academy: AcademyScreen,
  tavern: TavernScreen,
  temple: TempleScreen,
  resource: ResourceScreen,
  tradegood: TradegoodScreen,
  armyGarrisonEdit: GarrisonEditScreen,
  fleetGarrisonEdit: GarrisonEditScreen,
  renameCity: RenameCityScreen,
  demolition: DemolitionScreen,
  abolishColony: AbolishColonyScreen,
  sendIKMessage: SendMessageScreen,
  sendSpy: SendSpyScreen,
  buildingGround: BuildingGroundScreen,
  safehouseMissions: SafehouseMissionsScreen,

  // Wave 3: read-only tables.
  finances: FinancesScreen,
  highscore: HighscoreScreen,
  version: VersionScreen,
  credits: CreditsScreen,
  buildingDetail: BuildingDetailScreen,
  wonder: WonderScreen,
  wonderDetail: WonderDetailScreen,
  researchAdvisor: ResearchAdvisorScreen,
  researchOverview: ResearchOverviewScreen,
  researchDetail: ResearchDetailScreen,
  merchantNavy: MerchantNavyScreen,
  tradeAdvisor: TradeAdvisorScreen,
  diplomacyAdvisor: DiplomacyAdvisorScreen,
  diplomacyAdvisorOutBox: DiplomacyOutboxScreen,
  militaryAdvisorMilitaryMovements: MilitaryMovementsScreen,
  militaryAdvisorCombatReports: CombatReportsScreen,
  militaryAdvisorCombatReportsArchive: CombatReportsArchiveScreen,
  cityMilitary: CityMilitaryScreen,
  safehouseReports: SafehouseReportsScreen,

  // Wave 4: the interactive screens.
  barracks: BarracksScreen,
  shipyard: ShipyardScreen,
  port: PortScreen,
  safehouse: SafehouseScreen,
  branchOffice: BranchOfficeScreen,
  takeOffer: TakeOfferScreen,
  transport: TransportScreen,
  colonize: ColonizeScreen,
  plunder: PlunderScreen,
  tradeAdvisorTradeRoute: TradeRouteScreen,

  // Wave 5: static and meta.
  pedia: PediaScreen,
  informations: InformationsScreen,
  options: OptionsScreen,
  options_deletion_confirm: DeletionConfirmScreen,
  premium: PremiumScreen,
  premiumDetails: PremiumDetailsScreen,
  premiumPayment: PremiumPaymentScreen,
  premiumTradeAdvisor: PremiumTradeAdvisorScreen,
}

export function screenFor(page: Page): Screen {
  return SCREENS[page] ?? ErrorScreen
}
