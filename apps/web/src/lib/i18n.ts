/**
 * The legacy's `$this->lang->line(...)`, widened from one language to two.
 *
 * One flat map of 1,466 keys per language, loaded whole because that is what
 * the legacy did (CodeIgniter's Lang class read the entire site_lang.php on
 * every request) and because at 130 KB it is smaller than the sprite sheet for
 * a single screen.
 *
 * The active language is Turkish by default; English stays selectable. The
 * choice lives in localStorage (and a `lang` cookie for any future
 * server-side use), not per-account in the database -- the legacy stored it
 * in the session only, and the port has no session-persisted options.
 *
 * A missing key renders as the empty string. That is CI's behaviour, not a
 * convenience: `Language::line()` returns FALSE for an unknown key
 * (izariam/system/libraries/Language.php:115) and `<?=FALSE?>` prints nothing,
 * so several legacy screens have blanks where a caption should be. Rendering
 * the key name instead would look like a port bug and hide a real one.
 * Turkish keys that are ever absent fall back to English before giving up.
 */

import { EN, TR } from '@izariam/gamedata'

export type Locale = 'tr' | 'en'

/** The netbar switcher renders one entry per locale, in this order. */
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'English' },
]

const DEFAULT_LOCALE: Locale = 'tr'
const STORAGE_KEY = 'izariam_lang'

/**
 * Strings the legacy templates hardcoded instead of putting in the language
 * file -- most of them in Russian, a few in English -- so there is no key to
 * look up. Translated once here rather than scattered as literals through the
 * screens, and kept apart from the catalogs so it is obvious which strings the
 * original never localised. HARDCODED_TR is the Turkish side of the same
 * list; where a key also exists in the catalogs, the catalog wins.
 *
 * `overviews`, `pedia0_0` and `pedia0_0_1` were left out on purpose for a
 * while: the keys are missing from every language file the legacy shipped, so
 * the advisors heading and the encyclopedia's first two captions were blank
 * there too. They are filled in now. Reproducing a legacy defect is worth it
 * when it is visible as a defect; a heading that simply is not there reads as
 * a bug in this port, not as fidelity to the original.
 *
 * Everything below `reset_dev_link` is text the port owns outright: the nine
 * tutorial scripts, the player-facing wording for every rejection the rules
 * engine can return, and the screen copy the legacy hardcoded in its
 * templates. A key here that the client asks for and does not find renders as
 * the empty string, which is why `coverage.test.ts` audits both directions.
 */
const HARDCODED: Record<string, string> = {
  // Sliders (мин. / макс.), used by four screens.
  min: 'min',
  max: 'max',
  // Tavern (tavern.php)
  cheers: 'Cheers!',
  prepare_drinks: 'Prepare drinks',
  prepare_wine: 'Prepare wine',
  prepare_wine_desc:
    'You can set how much grape is spent on making wine. The more grape, the more wine, and the happier your citizens. Note: the innkeeper takes an hour`s worth of grape every time the ration changes.',
  no_wine: 'No grape',
  happy_citizens: 'happy citizens',
  // Saw mill / mine (resource.php, tradegood.php)
  saw_mill_desc:
    'Timber reaches the saw mill from the neighbouring forest. Once worked it becomes the building material your buildings need. The saw mill is improved by every resident of the island; the larger it is, the more workers you can put on it.',
  mine: 'Mine',
  mine_desc:
    'The mine is improved by every resident of the island. The larger it is, the more workers you can put on it.',
  other_players_island: 'Other players on this island',
  donated: 'Donated',
  production: 'Production',
  research_needed: 'You need to research `wealth` first.',
  // Espionage (sendSpy.php, safehouseMissions.php)
  send_spy_text:
    'Send spies into other players` towns to gather intelligence. Once a spy is inside you can give them orders. Bear in mind that there is always some risk of a spy being exposed; their reports are filed with the diplomacy advisor.',
  send_spy_desc: 'Your spy will try to slip into the town. It is easiest to disappear into the population of a large one.',
  risk_detection: 'Risk of detection',
  risk: 'Risk',
  current_risk: 'Current risk of detection',
  travel_time: 'Travel time',
  choose_mission: 'Choose a mission for your spy in',
  give_spy_order: 'Give your spy an order',
  mission_name: 'Mission name',
  mission_desc: 'Mission description',
  mission_cost: 'Cost of this mission',
  mission_risk: 'Risk of this mission',
  start_mission: 'Start mission',
  spy_mission_10_name: 'Recall the spy',
  // Chrome and forms
  city_resources: 'City resources',
  inhabitants: 'Citizens',
  not_spyes: 'No spies available',
  confirm_demolish: 'Confirm demolition',
  following_resources_2: 'You will get these resources back:',
  message: 'Message',
  message_sent: 'Message sent.',
  // Start page (main_index_4.php) -- its own template, no language file keys.
  accept_terms_1: 'With the login I accept the',
  accept_terms_link: 'T&C',
  accept_terms_2: '.',
  // Port, the loading pier (port.php:56-171 -- literals in the original).
  port_load_fleets: 'Fleets on load',
  port_own_ships: 'My trade ships',
  port_foreign_ships: 'Foreign ships',
  port_no_ships: 'No ships registered in the port',
  port_arriving: 'Arriving merchants',
  port_loading_status: 'Loading',
  port_waiting: 'Waiting',
  // Compose mail (sendIKMessage.php -- literals in the original).
  send_message_intro:
    'You can write to other players here, or offer them a treaty once you have researched its type.',
  send_chars_1: 'Available',
  send_chars_2: 'characters.',
  // Research screens (researchAdvisor.php, researchOverview.php)
  research: 'Research',
  status: 'Status',
  explored: 'Researched',
  unexplored: 'Not researched',
  requirements: 'Requirements',
  // Advisor screens
  cities: 'Towns',
  no_reports: 'There are no reports.',
  buy_transporter: 'Buy a cargo ship',
  tutorial: 'Tutorial',
  skip: 'Skip',
  learn_more: 'Learn more about',
  no_units: 'There are no troops in this town.',
  plunder_unavailable:
    'Plundering was never implemented: the legacy has no combat resolution and no handler behind this form.',
  trade_routes: 'Trade routes',
  trade_routes_text: 'A standing order fires once a day at the hour you choose.',
  no_trade_routes: 'You have no trade routes.',
  new_trade_route: 'New trade route',
  create: 'Create',
  time: 'Time',
  city_select: 'Town selector',
  city_select_0: 'Dropdown',
  city_select_1: 'List',
  city_select_2: 'Compact',
  old_password: 'Current password',
  new_password: 'New password',
  repeat_password: 'Repeat the new password',
  delete_account: 'Delete account',
  delete_account_text: 'Deleting an account cannot be undone.',
  delete_account_unavailable:
    'Account deletion was never implemented: the confirm button posts to a controller that does not exist.',
  premium: 'Boost',
  buy: 'Buy',
  premium_account: 'Premium account',
  premium_wood: 'Wood production',
  premium_wine: 'Wine production',
  premium_marble: 'Marble production',
  premium_crystal: 'Crystal production',
  premium_sulfur: 'Sulphur production',
  premium_capacity: 'Warehouse capacity',
  premium_payment_unavailable:
    'Ambrosia is granted at registration; the legacy never wired up a payment provider.',
  sender: 'From',
  recipient: 'To',
  no_messages: 'No messages.',
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  mission_transport: 'Transport',
  mission_colonise: 'Colonisation',
  mission_buy: 'Purchase',
  mission_sell: 'Sale',
  // Port and safehouse (port.php, safehouse.php)
  cargo_ship_desc:
    'Cargo ships are one of the most important parts of a growing empire. They carry peaceful goods just as readily as they serve a war.',
  send_transporter: 'Send a cargo ship',
  spy_training: 'Spy training',
  spy: 'Spy',
  spy_desc:
    'This citizen is loyal and discreet in equal measure -- the ideal candidate for a spy.',
  train: 'Train',
  training_started: 'Training has begun.',
  max_spies: 'Maximum number of spies reached.',
  spies_on_mission: 'Spies on missions',
  no_spies: 'You have no spies in the field.',
  residence: 'Residence',
  // Trade screens (branchOffice.php, takeOffer.php, transport.php, colonize.php)
  no_offers: 'This branch office has nothing on offer.',
  transporters: 'Cargo ships',
  freight: 'Freight',
  transport_text: 'Choose what to load and how many ships to send.',
  colonize_text:
    'A colony costs 1,250 wood, 9,000 gold, 40 citizens and one action point, plus whatever you load on top.',
  // Auth outcomes the legacy had no key for: it built the ban message inline
  // (player_model.php:271) and its password reset mailed a new password rather
  // than a link, so `success_password` describes something this no longer does.
  error_blocked: 'This account is blocked until %s.',
  error_reset_token: 'This password reset link is invalid or has expired.',
  error_input: 'Please check the details you entered.',
  success_password_reset: 'If that address belongs to an account, a reset link is on its way.',
  success_password_changed: 'Your password has been changed. You can log in now.',
  reset_dev_link: 'This stack sends no mail, so the reset link is:',

  // -------------------------------------------------------------------------
  // The tutorial, izariam/views/tut/0-8.php
  //
  // The legacy kept these in the templates rather than the language file, and
  // eight of the nine are in Russian -- there is no Russian language pack in
  // the repo, so the English below is already a translation. `tut6_body` is
  // the exception with no legacy original at all: tut/6.php's body is a
  // byte-for-byte copy of tut/5.php's, clearly a mistake, so the wall step
  // gets its own line here.
  // -------------------------------------------------------------------------
  tut0_body:
    'Welcome to the realm of Ikaria. We are your advisers, and we will tell you about ' +
    'everything of note in your towns, your armies, your research and your diplomacy. ' +
    'We appear at the start of every game to walk you through the first steps. If you ' +
    'need us later, click the symbols in the upper left of the play window.',
  tut1_body:
    'I am Peleus, master of the saw mill. Our workers labour here for the building ' +
    'material your buildings and ships need -- and your soldiers need it too. Visit the ' +
    'saw mill through the Island button and set how many of your citizens work there. ' +
    'The Town button brings you back.',
  tut2_body:
    'I am Manuron, your administrator, and I always know what is happening here. I will ' +
    'tell you about everything important in your towns. For now, I suggest you build an ' +
    'academy: click one of the red flags and choose it there.',
  tut3_body:
    'My name is Lysias and I speak for the progress of your empire. Visit the academy ' +
    'and put people to work on a research. When they have gathered what they need, my ' +
    'portrait will light up. Every research is described in the academy library.',
  tut4_body:
    'Excellent -- learned minds are coming to your town. Now think about defending it. ' +
    'Build barracks: click a red flag and choose them from the construction menu.',
  tut5_body:
    'My name is Ajax. I can tell you about every fleet movement I know of, and about ' +
    'battles under way or finished. Now recruit a spearman in the barracks.',
  tut6_body:
    'My name is Ajax. A wall is what keeps a town standing. Build one on the wall slot ' +
    'at the edge of your town.',
  tut7_body:
    'My name is Issus and I will keep you informed about the other civilisations. Now I ' +
    'would build a trading port -- click one of the blue flags. From the port you can ' +
    'buy a cargo ship, which is what carries goods to other towns.',
  tut8_body:
    'Building is not enough on its own; buildings have to grow. Enter one and press ' +
    'Upgrade. Remember that only one building can be upgraded at a time -- and that the ' +
    'saw mill, the quarry and the altar belong to everyone on the island, so they are ' +
    'improved by everyone.',

  // -------------------------------------------------------------------------
  // Rejection reasons.
  //
  // `App.tsx` puts the API's error code straight into `ctx.failure` and 24
  // screens render it through t(). A code with no entry here renders as the
  // empty string, so a refused action used to show an empty red line -- worse
  // than showing English. These are the player-facing wording for every
  // `reject()` / `fail()` string the rules engine and the API can return.
  //
  // `enough_action_points` and `not_enough_action_points` are the same refusal
  // under two names: trade.ts emits the first, colony.ts:259 the second. The
  // engine strings are pinned by golden fixtures and must not be renamed, so
  // both keys exist and say the same thing.
  // -------------------------------------------------------------------------
  not_enough_action_points: 'You have no action points left.',
  not_enough_resources: 'You do not have enough resources.',
  not_enough_gold: 'You do not have enough gold.',
  not_enough_crystal: 'You do not have enough crystal.',
  not_enough_ambrosia: 'You do not have enough ambrosia.',
  not_enough_research_points: 'You do not have enough research points.',
  not_enough_transports: 'You do not have enough cargo ships.',
  not_enough_cargo_space: 'The cargo will not fit in the ships you sent.',
  construction_not_allowed: 'You cannot build that here.',
  construction_entry_missing: 'There is no such entry in the construction list.',
  no_construction: 'Nothing is under construction in this town.',
  construction_other_slot: 'That is not the building at the head of the queue.',
  hurry_half: 'Shorten building time',
  hurry_all: 'Complete instantly',
  hurry_free: 'free',
  // Temple, priests and miracles. The legacy has the wonder texts but no words
  // for any of this, because none of it could happen.
  faith: 'Faith',
  island_faith: 'Island faith',
  no_priests: 'No priests serve in this town yet.',
  miracle: 'Miracle',
  miracle_activate: 'Call the miracle',
  miracle_active_for: 'The miracle is working. Time left:',
  priests_rejected: 'More priests than the temple can house.',
  no_wonder: 'This island has no wonder.',
  no_temple_on_island: 'You have no temple on this island.',
  faith_too_low: 'The island does not believe enough yet.',
  faith_too_low_hint: 'The island must reach %s faith before the god listens.',
  miracle_cooling_down: 'The god is not ready to be asked again.',
  miracle_needs_combat: 'This miracle only works in battle, and there is no combat here yet.',
  // The monument: its expansion, and who on the island paid for it.
  wonder_level: 'Monument level',
  wonder_donate: 'Expand the monument',
  wonder_donate_desc:
    'Every player on the island may give. The monument takes the three luxuries the island does not produce itself.',
  wonder_next_level: 'Still needed for the next level',
  wonder_complete: 'The monument is fully expanded.',
  wonder_limits_miracle:
    'A monument at level %s carries no more than that, however much the island believes.',
  island_share: 'Island share',
  converted: 'Converted',
  donor: 'Player',
  wonder_no_wonder: 'This island has no monument.',
  wonder_max_level: 'The monument is already fully expanded.',
  wonder_wrong_good: 'The island produces that good itself; the monument will not take it.',
  island_wonder_upgraded: 'The island monument reached level %s.',
  abort_buildings_no_effect: 'There is nothing to cancel.',
  queue_empty: 'The queue is empty.',
  unit_queue_full: 'The recruitment queue is full.',
  barracks_missing: 'You have no barracks in this town.',
  shipyard_missing: 'You have no shipyard in this town.',
  barracks_in_build_queue: 'The barracks are being built or upgraded.',
  shipyard_in_build_queue: 'The shipyard is being built or upgraded.',
  tavern_not_at_position: 'There is no tavern on that plot.',
  tavern_level_too_low: 'The tavern level is too low for that.',
  donation_rejected: 'That donation was refused.',
  resource_workers_rejected: 'That many people cannot work the saw mill.',
  tradegood_workers_rejected: 'That many people cannot work the resource node.',
  scientists_rejected: 'That many people cannot work in the academy.',
  branch_office_unaffordable: 'You cannot afford that branch office offer.',
  invalid_trade_route: 'That trade route is not valid.',
  unknown_trade_route: 'No such trade route.',
  unknown_route: 'No such route.',
  unknown_trade_type: 'Unknown type of offer.',
  fleet_already_returning: 'That fleet is already on its way home.',
  not_your_fleet: 'That fleet is not yours.',
  unknown_mission: 'No such mission.',
  mission_out_of_range: 'That mission is out of range.',
  no_target: 'No target was chosen.',
  unknown_target: 'No such target.',
  island_not_loaded: 'That island could not be loaded.',
  island_slot_occupied: 'That island slot is taken.',
  island_slot_out_of_range: 'There is no such island slot.',
  town_not_on_island: 'That town is not on this island.',
  town_not_active: 'That town is not founded yet.',
  unknown_town: 'No such town.',
  no_current_town: 'No town is selected.',
  colony_limit_reached: 'You have reached your colony limit.',
  already_capital: 'That town is already your capital.',
  no_palace: 'You need a palace and a governor`s residence for that.',
  position_mismatch: 'That building is not on the plot you chose.',
  safehouse_full: 'The safehouse is full.',
  no_idle_spy: 'You have no spy free for that.',
  spy_not_found: 'No such spy.',
  unknown_spy: 'No such spy.',
  spy_has_no_target: 'That spy has no target.',
  spy_target_invalid: 'That spy cannot be sent there.',
  spy_already_training: 'A spy is already in training.',
  unknown_research: 'No such research.',
  unknown_premium_type: 'No such boost.',
  unknown_message: 'No such message.',
  unknown_message_type: 'That kind of message cannot be sent.',
  unknown_recipient: 'No such player.',
  invalid_name: 'That name cannot be used.',
  invalid_option: 'That setting is not valid.',
  login_taken: 'That name is already used.',
  password_mismatch: 'The two passwords do not match.',
  password_too_short: 'The password needs to have between 8 and 30 characters.',
  password_unchanged: 'The new password is the same as the old one.',
  bad_credentials: 'Wrong password.',
  account_blocked: 'This account is blocked.',
  unchanged: 'Nothing changed.',
  no_player: 'This account has no player data.',
  not_authenticated: 'You are not logged in.',
  csrf_failed: 'The request could not be verified. Please try again.',
  invalid_request: 'The request was not valid.',
  internal_error: 'Something went wrong. Please try again.',
  espionage_rejected: 'The mission was refused.',

  // -------------------------------------------------------------------------
  // Screen text the port wrote itself, or that the legacy hardcoded in its
  // templates. Keys that already exist in the language file are reused at the
  // call site instead of being restated here.
  // -------------------------------------------------------------------------
  // Advisors panel. `overviews` is absent from every language file the legacy
  // shipped, so the heading was blank there. Filled: a blank heading reads as a
  // port bug, and the port already corrects legacy defects of this kind.
  overviews: 'Overviews',
  // The encyclopedia's first two captions, blank in the legacy for the same
  // reason (see Pedia.tsx).
  pedia0_0: 'Encyclopedia',
  pedia0_0_1: 'Overview',
  // Reference / credits (version.php). The changelog entries themselves stay
  // in English: they are a historical record of what changed, not UI copy.
  developers: 'Developers',
  collaborators: 'Collaborators',
  ex_developers: 'Ex-developers',
  all_rights_reserved: 'All rights reserved.',
  development_forum: 'Development Forum',
  // Research
  previous_research: 'Previous research',
  previous_research_text:
    'All your previous research is kept in the library archive, where any visitor may consult it.',
  research_done: 'Research already carried out',
  prerequisite_unresearched: 'At least one prerequisite is unresearched (next required: %s)',
  // Palace / palaceColony
  towns_of_empire: 'Towns of your empire',
  no_occupied_cities: 'You have no occupied cities.',
  move_capital: 'Move the capital',
  move_capital_text:
    'You can make this colony your capital. The governor`s residence becomes a palace of ' +
    'the same level and the town becomes the seat of the empire — but the palace in your ' +
    'former capital is destroyed, and you will have to build a new governor`s residence there.',
  move_capital_confirm:
    'Do you really want to make %s your capital? The governor`s residence becomes the new ' +
    'palace, and the level %s palace in %s is demolished outright — no resources are ' +
    'returned and the build cost is lost.',
  move_capital_button: 'Make this town the capital',
  // Wall
  terrain_attack: 'Terrain attack',
  damage: 'Damage',
  accuracy: 'Accuracy',
  health: 'Health',
  armour: 'Armour',
  garrison_limit: 'Garrison limit',
  // Town navigation
  previous_town: 'Previous town',
  next_town: 'Next town',
  show_world: 'Show world',
  show_island: 'Show island',
  show_town: 'Show town',
  // Warehouse
  goods_in_warehouse: 'Goods in the warehouse',
  warehouse_levels_text: 'This town has %s warehouses at levels %s.',
  insured: 'Insured',
  uninsured: 'Uninsured',
  // Chrome
  global_resources: 'Global resources',
  toolbar: 'Toolbar',
  up: 'Up',
  down: 'Down',
  under_construction_short: 'under construction',
  building_material_unknown: 'Building material: ???',
  invite_friends_text:
    'You want to invite friends to join iZariam? You want them to have a town near yours? ' +
    'Generate a link that you can pass on to your friends here.',
  hourly_production: 'Hourly production %s',
  // Town rename confirmation
  old_town_name: 'Old town name',
  new_town_name: 'New town name',
  accept_name: 'Accept name',
  // Error screen
  error_messages: 'Error message(s)',
  report_this_error: 'Report this error',
  // Highscore
  highscore_place_text: 'Place %s of the %s highscore list!',
  // App shell
  world_load_failed: 'Could not load the world',
  account_no_town: 'This account has no town.',
  no_town_state: 'No derived state for the selected town.',
  // Port / safehouse
  spy_max_note: 'Maximum: %s',
  // Slider handle, for screen readers.
  assignment: 'Assignment',
  // Island node headings. The legacy has `saw_mill` for wood but no key for the
  // other four, so the tradegood screen's <h1> was blank on every non-wood
  // island.
  wood_mine: 'Saw mill',
  wine_mine: 'Vines',
  marble_mine: 'Quarry',
  crystal_mine: 'Crystal mine',
  sulfur_mine: 'Sulfur pit',
  // Espionage mission descriptions. The language file carries
  // `spy_mission_N_name` but no `_desc`, so every description in the safehouse
  // mission list was blank.
  spy_mission_3_desc: 'Your spy counts the troops garrisoned in the town.',
  spy_mission_4_desc: 'Your spy reports what is stored in the town`s warehouses.',
  spy_mission_5_desc: 'Your spy lists the buildings in the town and their levels.',
  spy_mission_6_desc: 'Your spy reports what the town is researching.',
  spy_mission_7_desc: 'Your spy watches the port and reports the fleets that come and go.',
  spy_mission_8_desc: 'Your spy copies the town`s trade agreements.',
  spy_mission_9_desc: 'Your spy sows unrest and the town`s citizens grow unhappy.',
  spy_mission_10_desc: 'Your spy leaves the town and comes home.',

  // -------------------------------------------------------------------------
  // The premium shop (premium.php). Hardcoded Russian in the legacy, no keys.
  //
  // `premium_buy` exists because the catalog's `buy` means "I am looking for"
  // -- the branch office's search caption -- and wins the lookup, so the shop
  // button read "Arıyorum".
  // -------------------------------------------------------------------------
  premium_intro:
    'iZariam PLUS gives you better overviews, a longer construction list and a boost to what ' +
    'your island yields. Every boost runs for a week and can be extended at any time.',
  premium_buy: 'Buy',
  premium_duration_days: '%s days',
  premium_remaining: 'Remaining: %s',
  premium_missing: '%s ambrosia short!',
  premium_account_desc:
    'Better overviews of your towns, your research and your fleets, and a construction list ' +
    'you can queue into.',
  premium_wood_desc: '20% more building material from your island`s forest.',
  premium_wine_desc: '20% more grape from your island`s vines.',
  premium_marble_desc: '20% more marble from your island`s quarry.',
  premium_crystal_desc: '20% more crystal from your island`s mine.',
  premium_sulfur_desc: '20% more sulfur from your island`s pit.',
  premium_capacity_desc: 'Doubles what your safe storage keeps out of a plunderer`s reach.',

  // -------------------------------------------------------------------------
  // Town advisor notices.
  //
  // The legacy stored each of these as a rendered HTML sentence in
  // `town_messages.text` (update_model.php:206), so there was nothing to
  // translate and nothing to reuse. The port stores the event and its numbers
  // instead, which is why the sentences live here.
  // -------------------------------------------------------------------------
  msg_building_completed: 'Construction of "%s" is finished!',
  msg_building_upgraded: '"%s" has been raised to level %s!',
  msg_trade_route_started: 'A trade route has set off.',
  msg_mission_colony_founded: 'Your colony has been founded.',
  msg_mission_transport_received: 'A transport has arrived in your town.',
  msg_mission_transport_delivered: 'Your transport has been delivered.',
  msg_mission_buy_loading: 'Your purchase is being loaded.',
  msg_mission_buy_loading_incoming: 'A buyer is loading goods in your town.',
  msg_mission_buy_empty: 'The offer was gone before your ships arrived.',
  msg_mission_sell_unloaded: 'Your sale has been unloaded.',
  msg_mission_sell_unloaded_incoming: 'A seller has unloaded goods in your town.',
  msg_mission_fleet_returned: 'Your fleet is home again.',
}

/** The Turkish half of the same list, same keys, translated. */
const HARDCODED_TR: Record<string, string> = {
  min: 'min.',
  max: 'maks.',
  cheers: 'Şerefe!',
  prepare_drinks: 'İçecek hazırla',
  prepare_wine: 'Şarap hazırla',
  prepare_wine_desc:
    'Üzümün ne kadarının şarap yapımında harcanacağını buradan ayarlayabilirsin. Ne kadar çok üzüm, o kadar çok şarap ve o kadar mutlu vatandaşlar. Not: Meyhaneci, tayın her değişiminde bir saatlik üzümü alır.',
  no_wine: 'Üzüm yok',
  happy_citizens: 'mutlu vatandaş',
  saw_mill_desc:
    'Kereste, komşu ormandan kereste fabrikasına ulaşır. İşlendikten sonra binalarınızın ihtiyaç duyduğu inşaat malzemesine dönüşür. Kereste fabrikası adadaki her sakin tarafından geliştirilir; ne kadar büyükse o kadar çok işçi çalıştırabilirsin.',
  mine: 'Maden',
  mine_desc:
    'Maden, adadaki her sakin tarafından geliştirilir. Ne kadar büyükse o kadar çok işçi çalıştırabilirsin.',
  other_players_island: 'Bu adadaki diğer oyuncular',
  donated: 'Bağışlanan',
  production: 'Üretim',
  research_needed: 'Önce `Refah` araştırmasını yapman gerekir.',
  send_spy_text:
    'Diğer oyuncuların şehirlerine istihbarat toplamak için casuslar gönder. Bir casuz içeride olduğunda ona emir verebilirsin. Bir casusun her zaman ortaya çıkma riski olduğunu unutma; raporları diplomasi danışmanına sunulur.',
  send_spy_desc:
    'Casusun şehre sızmaya çalışacak. Kalabalık bir şehrin nüfusuna karışmak en kolayıdır.',
  risk_detection: 'Yakalanma riski',
  risk: 'Risk',
  current_risk: 'Mevcut yakalanma riski',
  travel_time: 'Seyahat süresi',
  choose_mission: 'Şehirdeki casusun için bir görev seç:',
  give_spy_order: 'Casusuna bir emir ver',
  mission_name: 'Görev adı',
  mission_desc: 'Görev açıklaması',
  mission_cost: 'Bu görevin maliyeti',
  mission_risk: 'Bu görevin riski',
  start_mission: 'Göreve başla',
  spy_mission_10_name: 'Casusu geri çağır',
  city_resources: 'Şehir kaynakları',
  inhabitants: 'Vatandaşlar',
  not_spyes: 'Kullanılabilir casus yok',
  confirm_demolish: 'Yıkımı onayla',
  following_resources_2: 'Bu kaynakları geri alacaksın:',
  message: 'Mesaj',
  message_sent: 'Mesaj gönderildi.',
  accept_terms_1: 'Giriş yaparak',
  accept_terms_link: 'Kuralları',
  accept_terms_2: 'kabul etmiş olurum.',
  port_load_fleets: 'Yüklemdeki filolar',
  port_own_ships: 'Ticaret gemilerim',
  port_foreign_ships: 'Yabancı gemiler',
  port_no_ships: 'Limanda kayıtlı gemi yok',
  port_arriving: 'Gelen tüccarlar',
  port_loading_status: 'Yükleniyor',
  port_waiting: 'Bekliyor',
  send_message_intro:
    'Buradan diğer oyunculara mesaj yazabilir ya da araştırdığın antlaşma türlerini onlara önerebilirsin.',
  send_chars_1: 'Kullanılabilir',
  send_chars_2: 'karakter.',
  research: 'Araştırma',
  status: 'Durum',
  explored: 'Araştırıldı',
  unexplored: 'Araştırılmadı',
  requirements: 'Gereksinimler',
  cities: 'Şehirler',
  no_reports: 'Görüntülenecek rapor yok.',
  buy_transporter: 'Ticaret gemisi satın al',
  tutorial: 'Eğitim',
  skip: 'Atla',
  learn_more: 'Daha fazlasını öğren:',
  no_units: 'Bu şehirde birlik yok.',
  plunder_unavailable:
    'Yağmalama hiç uygulanmadı: eski sürümde savaş çözümlemesi ve bu formun arkasında bir işleyici yok.',
  trade_routes: 'Ticaret rotaları',
  trade_routes_text: 'Kalıcı bir emir, seçtiğin saatte günde bir kez uygulanır.',
  no_trade_routes: 'Hiç ticaret rotan yok.',
  new_trade_route: 'Yeni ticaret rotası',
  create: 'Oluştur',
  time: 'Zaman',
  city_select: 'Şehir seçici',
  city_select_0: 'Açılır liste',
  city_select_1: 'Liste',
  city_select_2: 'Kompakt',
  old_password: 'Mevcut şifre',
  new_password: 'Yeni şifre',
  repeat_password: 'Yeni şifreyi tekrar gir',
  delete_account: 'Hesabı sil',
  delete_account_text: 'Hesap silme geri alınamaz.',
  delete_account_unavailable:
    'Hesap silme hiç uygulanmadı: onay düğmesi var olmayan bir denetleyiciye gönderme yapıyor.',
  premium: 'Güçlendirme',
  buy: 'Satın al',
  premium_account: 'Premium hesap',
  premium_wood: 'Odun üretimi',
  premium_wine: 'Şarap üretimi',
  premium_marble: 'Mermer üretimi',
  premium_crystal: 'Kristal üretimi',
  premium_sulfur: 'Sülfür üretimi',
  premium_capacity: 'Depo kapasitesi',
  premium_payment_unavailable:
    'Ambrosia kayıt sırasında verilir; eski sürümde hiçbir ödeme sağlayıcısı bağlanmadı.',
  sender: 'Gönderen',
  recipient: 'Alıcı',
  no_messages: 'Mesaj yok.',
  read: 'Oku',
  edit: 'Düzenle',
  delete: 'Sil',
  mission_transport: 'Nakliye',
  mission_colonise: 'Kolonileşme',
  mission_buy: 'Satın alma',
  mission_sell: 'Satış',
  cargo_ship_desc:
    'Ticaret gemileri, büyüyen bir imparatorluğun en önemli parçalarından biridir. Barışçıl malları taşıdıkları kadar bir savaşa da aynı kolaylıkla hizmet ederler.',
  send_transporter: 'Ticaret gemisi gönder',
  spy_training: 'Casus eğitimi',
  spy: 'Casus',
  spy_desc: 'Bu vatandaş aynı ölçüde sadık ve konuşmaz -- bir casus için ideal aday.',
  train: 'Eğit',
  training_started: 'Eğitim başladı.',
  max_spies: 'Azami casus sayısına ulaşıldı.',
  spies_on_mission: 'Görevdeki casuslar',
  no_spies: 'Sahada hiç casusun yok.',
  residence: 'Konak',
  no_offers: 'Bu ticaret merkezinde sunulan hiçbir şey yok.',
  transporters: 'Ticaret gemileri',
  freight: 'Yük',
  transport_text: 'Ne yükleneceğini ve kaç gemi gönderileceğini seç.',
  colonize_text:
    'Bir koloni; 1.250 odun, 9.000 altın, 40 vatandaş ve bir eylem puanı ister, üzerine yüklediklerin hariç.',
  error_blocked: 'Bu hesap %s tarihine kadar engellendi.',
  error_reset_token: 'Bu şifre sıfırlama bağlantısı geçersiz ya da süresi dolmuş.',
  error_input: 'Girdiğin bilgileri kontrol et.',
  success_password_reset: 'Bu adres bir hesaba aitse, sıfırlama bağlantısı yolda.',
  success_password_changed: 'Şifren değiştirildi. Artık giriş yapabilirsin.',
  reset_dev_link: 'Bu kurulumdan e-posta gönderilmiyor; sıfırlama bağlantısı:',

  // Eğitim (tut/0-8.php)
  tut0_body:
    'Ikaria diyarına hoş geldin. Biz danışmanlarınız; şehirlerinde, ordularında, ' +
    'araştırmalarında ve diplomasinde kayda değer ne olursa sana anlatırız. Her oyunun ' +
    'başında ortaya çıkar, ilk adımlarında sana eşlik ederiz. Sonradan bize ihtiyacın ' +
    'olursa oyun penceresinin sol üstündeki simgelere tıkla.',
  tut1_body:
    'Ben Peleus, kereste fabrikasının başındayım. İşçilerimiz burada, binalarının ve ' +
    'gemilerinin ihtiyaç duyduğu inşaat malzemesi için çalışır — askerlerinin de ona ' +
    'ihtiyacı var. Ada düğmesinden kereste fabrikasına git ve vatandaşlarından kaçının ' +
    'orada çalışacağını ayarla. Şehir düğmesi seni geri getirir.',
  tut2_body:
    'Ben Manuron, yöneticinim; burada olup biteni her zaman bilirim. Şehirlerindeki her ' +
    'önemli şeyi sana anlatacağım. Şimdilik bir akademi inşa etmeni öneririm: kırmızı ' +
    'bayraklardan birine tıkla ve oradan akademiyi seç.',
  tut3_body:
    'Adım Lysias; imparatorluğunun ilerlemesi benim işim. Akademiye uğra ve insanları bir ' +
    'araştırmaya koy. Gerekeni topladıklarında portrem yanacak. Her araştırmanın ' +
    'açıklamasını akademi kütüphanesinde bulursun.',
  tut4_body:
    'Harika — şehrine bilgili zihinler geliyor. Sıra onu savunmakta. Kışla inşa et: ' +
    'kırmızı bir bayrağa tıkla ve inşaat menüsünden kışlayı seç.',
  tut5_body:
    'Adım Ajax. Bildiğim her donanma hareketini, süren ve biten her savaşı sana ' +
    'anlatabilirim. Şimdi kışlada bir mızrakçı topla.',
  tut6_body:
    'Adım Ajax. Bir şehri ayakta tutan şey suru. Şehrinin kenarındaki sur alanına bir ' +
    'tane inşa et.',
  tut7_body:
    'Adım Issus; diğer uygarlıklar hakkında seni haberdar edeceğim. Şimdi bir ticaret ' +
    'limanı kurardım — mavi bayraklardan birine tıkla. Limandan bir ticaret gemisi ' +
    'alabilirsin; malları başka şehirlere taşıyan odur.',
  tut8_body:
    'İnşa etmek tek başına yetmez; binaların büyümesi gerekir. Birine gir ve Yükselt ' +
    'düğmesine bas. Unutma: aynı anda yalnızca bir bina yükseltilebilir — ve kereste ' +
    'fabrikası, taş ocağı ile sunak adadaki herkese aittir, bu yüzden herkes tarafından ' +
    'geliştirilir.',

  // Red gerekçeleri
  not_enough_action_points: 'Eylem puanın kalmadı.',
  not_enough_resources: 'Yeterli kaynağın yok.',
  not_enough_gold: 'Yeterli altının yok.',
  not_enough_crystal: 'Yeterli kristalin yok.',
  not_enough_ambrosia: 'Yeterli Ambrosia`n yok.',
  not_enough_research_points: 'Yeterli araştırma puanın yok.',
  not_enough_transports: 'Yeterli ticaret gemin yok.',
  not_enough_cargo_space: 'Gönderdiğin gemilere bu yük sığmıyor.',
  construction_not_allowed: 'Buraya bunu inşa edemezsin.',
  construction_entry_missing: 'İnşaat listesinde böyle bir kayıt yok.',
  no_construction: 'Bu şehirde süren bir inşaat yok.',
  construction_other_slot: 'Sıranın başındaki inşaat bu bina değil.',
  hurry_half: 'Süreyi yarıya indir',
  hurry_all: 'Hemen tamamla',
  hurry_free: 'ücretsiz',
  faith: 'İnanç',
  island_faith: 'Ada inancı',
  no_priests: 'Bu şehirde henüz rahip yok.',
  miracle: 'Mucize',
  miracle_activate: 'Mucizeyi çağır',
  miracle_active_for: 'Mucize sürüyor. Kalan:',
  priests_rejected: 'Tapınağın alacağından fazla rahip.',
  no_wonder: 'Bu adada mucize yok.',
  no_temple_on_island: 'Bu adada tapınağın yok.',
  faith_too_low: 'Ada henüz yeterince inanmıyor.',
  faith_too_low_hint: 'Tanrının duyması için ada inancı %s olmalı.',
  miracle_cooling_down: 'Tanrı yeniden çağrılmaya hazır değil.',
  miracle_needs_combat: 'Bu mucize yalnız savaşta işe yarar; portta henüz savaş yok.',
  wonder_level: 'Anıt kademesi',
  wonder_donate: 'Anıtı genişlet',
  wonder_donate_desc:
    'Adadaki her oyuncu bağış yapabilir. Anıt, adanın kendi çıkarmadığı üç lüks malı kabul eder.',
  wonder_next_level: 'Sonraki kademe için gereken',
  wonder_complete: 'Anıt tümüyle genişletildi.',
  wonder_limits_miracle:
    '%s kademesindeki bir anıt, ada ne kadar inanırsa inansın bundan fazlasını taşımaz.',
  island_share: 'Ada payı',
  converted: 'Dinden dönen',
  donor: 'Oyuncu',
  wonder_no_wonder: 'Bu adada anıt yok.',
  wonder_max_level: 'Anıt zaten tümüyle genişletilmiş.',
  wonder_wrong_good: 'Adanın kendi çıkardığı mal; anıt bunu kabul etmez.',
  island_wonder_upgraded: 'Ada anıtı %s kademesine ulaştı.',
  abort_buildings_no_effect: 'İptal edilecek bir şey yok.',
  queue_empty: 'Kuyruk boş.',
  unit_queue_full: 'Birlik kuyruğu dolu.',
  barracks_missing: 'Bu şehirde kışlan yok.',
  shipyard_missing: 'Bu şehirde tersanen yok.',
  barracks_in_build_queue: 'Kışla inşa ediliyor ya da yükseltiliyor.',
  shipyard_in_build_queue: 'Tersane inşa ediliyor ya da yükseltiliyor.',
  tavern_not_at_position: 'O alanda meyhane yok.',
  tavern_level_too_low: 'Meyhanenin seviyesi bunun için düşük.',
  donation_rejected: 'Bu bağış kabul edilmedi.',
  resource_workers_rejected: 'Kereste fabrikasında bu kadar kişi çalışamaz.',
  tradegood_workers_rejected: 'Kaynak alanında bu kadar kişi çalışamaz.',
  scientists_rejected: 'Akademide bu kadar kişi çalışamaz.',
  branch_office_unaffordable: 'Bu ticaret merkezi teklifini karşılayamazsın.',
  invalid_trade_route: 'Bu ticaret rotası geçerli değil.',
  unknown_trade_route: 'Böyle bir ticaret rotası yok.',
  unknown_route: 'Böyle bir rota yok.',
  unknown_trade_type: 'Bilinmeyen teklif türü.',
  fleet_already_returning: 'Bu filo zaten dönüş yolunda.',
  not_your_fleet: 'Bu filo senin değil.',
  unknown_mission: 'Böyle bir görev yok.',
  mission_out_of_range: 'Bu görev menzil dışında.',
  no_target: 'Hedef seçilmedi.',
  unknown_target: 'Böyle bir hedef yok.',
  island_not_loaded: 'Bu ada yüklenemedi.',
  island_slot_occupied: 'Bu ada yeri dolu.',
  island_slot_out_of_range: 'Böyle bir ada yeri yok.',
  town_not_on_island: 'Bu şehir bu adada değil.',
  town_not_active: 'Bu şehir henüz kurulmadı.',
  unknown_town: 'Böyle bir şehir yok.',
  no_current_town: 'Seçili şehir yok.',
  colony_limit_reached: 'Koloni sınırına ulaştın.',
  already_capital: 'Bu şehir zaten başkentin.',
  no_palace: 'Bunun için bir saray ve bir vali konağı gerekir.',
  position_mismatch: 'Bu bina seçtiğin alanda değil.',
  safehouse_full: 'Sığınak dolu.',
  no_idle_spy: 'Bunun için boşta casusun yok.',
  spy_not_found: 'Böyle bir casus yok.',
  unknown_spy: 'Böyle bir casus yok.',
  spy_has_no_target: 'Bu casusun hedefi yok.',
  spy_target_invalid: 'Bu casus oraya gönderilemez.',
  spy_already_training: 'Zaten eğitilen bir casus var.',
  unknown_research: 'Böyle bir araştırma yok.',
  unknown_premium_type: 'Böyle bir güçlendirme yok.',
  unknown_message: 'Böyle bir mesaj yok.',
  unknown_message_type: 'Bu türde mesaj gönderilemez.',
  unknown_recipient: 'Böyle bir oyuncu yok.',
  invalid_name: 'Bu ad kullanılamaz.',
  invalid_option: 'Bu ayar geçerli değil.',
  login_taken: 'Bu ad zaten kullanımda.',
  password_mismatch: 'İki şifre birbirini tutmuyor.',
  password_too_short: 'Şifre 8 ile 30 karakter arasında olmalıdır.',
  password_unchanged: 'Yeni şifre eskisiyle aynı.',
  bad_credentials: 'Yanlış şifre.',
  account_blocked: 'Bu hesap engellendi.',
  unchanged: 'Değişen bir şey olmadı.',
  no_player: 'Bu hesaba ait oyuncu verisi yok.',
  not_authenticated: 'Giriş yapmadın.',
  csrf_failed: 'İstek doğrulanamadı. Lütfen tekrar dene.',
  invalid_request: 'İstek geçerli değil.',
  internal_error: 'Bir şeyler ters gitti. Lütfen tekrar dene.',
  espionage_rejected: 'Görev reddedildi.',

  // Ekran metinleri
  overviews: 'Genel bakış',
  pedia0_0: 'Ansiklopedi',
  pedia0_0_1: 'Genel bakış',
  developers: 'Geliştiriciler',
  collaborators: 'Katkıda bulunanlar',
  ex_developers: 'Eski geliştiriciler',
  all_rights_reserved: 'Tüm hakları saklıdır.',
  development_forum: 'Geliştirme Forumu',
  previous_research: 'Önceki araştırmalar',
  previous_research_text:
    'Yaptığın bütün araştırmalar kütüphane arşivinde tutulur; oraya gelen herkes ' +
    'bunlara bakabilir.',
  research_done: 'Tamamlanmış araştırmalar',
  prerequisite_unresearched: 'En az bir ön koşul araştırılmadı (sıradaki gereken: %s)',
  towns_of_empire: 'İmparatorluğunun şehirleri',
  no_occupied_cities: 'İşgal ettiğin şehir yok.',
  move_capital: 'Başkenti taşı',
  move_capital_text:
    'Bu koloniyi başkentin yapabilirsin. Vali konağı aynı seviyede bir saraya dönüşür ve ' +
    'şehir imparatorluğun merkezi olur — ama eski başkentindeki saray yıkılır ve oraya ' +
    'yeniden bir vali konağı inşa etmen gerekir.',
  move_capital_confirm:
    '%s şehrini gerçekten başkent yapmak istiyor musun? Vali konağı yeni saray olur ve ' +
    '%s şehrindeki %s seviyeli saray tamamen yıkılır — hiçbir kaynak geri gelmez, inşaat ' +
    'maliyeti kaybolur.',
  move_capital_button: 'Bu şehri başkent yap',
  terrain_attack: 'Arazi saldırısı',
  damage: 'Hasar',
  accuracy: 'İsabet',
  health: 'Dayanıklılık',
  armour: 'Zırh',
  garrison_limit: 'Garnizon sınırı',
  previous_town: 'Önceki şehir',
  next_town: 'Sonraki şehir',
  show_world: 'Dünyayı göster',
  show_island: 'Adayı göster',
  show_town: 'Şehri göster',
  goods_in_warehouse: 'Depodaki mallar',
  warehouse_levels_text: 'Bu şehirde %s depo var; seviyeleri: %s.',
  insured: 'Sigortalı',
  uninsured: 'Sigortasız',
  global_resources: 'Genel kaynaklar',
  toolbar: 'Araç çubuğu',
  up: 'Yukarı',
  down: 'Aşağı',
  under_construction_short: 'inşa hâlinde',
  building_material_unknown: 'İnşaat malzemesi: ???',
  invite_friends_text:
    'Arkadaşlarını iZariam`a davet etmek ister misin? Şehirlerinin seninkine yakın ' +
    'olmasını ister misin? Buradan onlara iletebileceğin bir bağlantı oluştur.',
  hourly_production: 'Saatlik üretim %s',
  old_town_name: 'Eski şehir adı',
  new_town_name: 'Yeni şehir adı',
  accept_name: 'Adı onayla',
  error_messages: 'Hata mesajları',
  report_this_error: 'Bu hatayı bildir',
  highscore_place_text: '%s listesinde %s. sıradasın!',
  world_load_failed: 'Dünya yüklenemedi',
  account_no_town: 'Bu hesabın şehri yok.',
  no_town_state: 'Seçili şehir için türetilmiş veri yok.',
  spy_max_note: 'Azami: %s',
  assignment: 'Atama',
  wood_mine: 'Kereste Fabrikası',
  wine_mine: 'Bağlar',
  marble_mine: 'Mermer Ocağı',
  crystal_mine: 'Kristal Madeni',
  sulfur_mine: 'Sülfür Ocağı',
  spy_mission_3_desc: 'Casusun şehirde konuşlu birlikleri sayar.',
  spy_mission_4_desc: 'Casusun şehrin depolarında ne olduğunu bildirir.',
  spy_mission_5_desc: 'Casusun şehirdeki binaları ve seviyelerini listeler.',
  spy_mission_6_desc: 'Casusun şehrin ne araştırdığını bildirir.',
  spy_mission_7_desc: 'Casusun limanı gözler; gelen giden filoları bildirir.',
  spy_mission_8_desc: 'Casusun şehrin ticaret anlaşmalarını kopyalar.',
  spy_mission_9_desc: 'Casusun huzursuzluk yayar, şehrin halkı mutsuzlaşır.',
  spy_mission_10_desc: 'Casusun şehirden ayrılıp geri döner.',

  // Premium mağazası
  premium_intro:
    'iZariam PLUS sana daha iyi genel görünümler, daha uzun bir inşaat listesi ve adanın ' +
    'verimine ek kazanç verir. Her güçlendirme bir hafta sürer ve istediğin zaman uzatılabilir.',
  premium_buy: 'Satın al',
  premium_duration_days: '%s gün',
  premium_remaining: 'Kalan: %s',
  premium_missing: '%s Ambrosia eksik!',
  premium_account_desc:
    'Şehirlerin, araştırmaların ve filolarının daha iyi genel görünümü, ve sıraya iş ' +
    'ekleyebileceğin bir inşaat listesi.',
  premium_wood_desc: 'Adanın ormanından %20 daha fazla inşaat malzemesi.',
  premium_wine_desc: 'Adanın bağlarından %20 daha fazla üzüm.',
  premium_marble_desc: 'Adanın mermer ocağından %20 daha fazla mermer.',
  premium_crystal_desc: 'Adanın kristal madeninden %20 daha fazla kristal.',
  premium_sulfur_desc: 'Adanın sülfür ocağından %20 daha fazla sülfür.',
  premium_capacity_desc: 'Yağmacıdan korunan güvenli depo miktarını ikiye katlar.',

  // Şehir danışmanı bildirimleri
  msg_building_completed: '"%s" inşaatı tamamlandı!',
  msg_building_upgraded: '"%s" %s. seviyeye yükseltildi!',
  msg_trade_route_started: 'Bir ticaret rotası yola çıktı.',
  msg_mission_colony_founded: 'Kolonin kuruldu.',
  msg_mission_transport_received: 'Şehrine bir nakliye ulaştı.',
  msg_mission_transport_delivered: 'Nakliyen teslim edildi.',
  msg_mission_buy_loading: 'Satın aldığın mallar yükleniyor.',
  msg_mission_buy_loading_incoming: 'Şehrinde bir alıcı mal yüklüyor.',
  msg_mission_buy_empty: 'Gemilerin varmadan teklif tükenmişti.',
  msg_mission_sell_unloaded: 'Sattığın mallar boşaltıldı.',
  msg_mission_sell_unloaded_incoming: 'Şehrinde bir satıcı mal boşalttı.',
  msg_mission_fleet_returned: 'Filon geri döndü.',
}

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'tr' || stored === 'en') return stored
  } catch {
    // Private mode or storage disabled: the default stands.
  }
  return DEFAULT_LOCALE
}

let locale: Locale = readStoredLocale()
const listeners = new Set<() => void>()

// The start page ships <html lang="tr">; keep it truthful after switches and
// on loads where the stored locale is English.
function applyDocumentLocale(): void {
  document.documentElement.lang = locale
  document.title = t('head_title')
}

if (typeof document !== 'undefined') applyDocumentLocale()

export function getLocale(): Locale {
  return locale
}

/** Switch language, persist the choice, and notify `subscribeLocale` callers. */
export function setLocale(next: Locale): void {
  if (next === locale) return
  locale = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
    // Mirrored into a cookie for any future server-side locale handling; the
    // API itself is language-blind.
    document.cookie = `lang=${next}; max-age=31536000; path=/; samesite=lax`
  } catch {
    // Storage unavailable: the switch still applies for this page load.
  }
  if (typeof document !== 'undefined') applyDocumentLocale()
  listeners.forEach((fn) => fn())
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function t(key: string): string {
  if (locale === 'tr') {
    return TR[key] ?? HARDCODED_TR[key] ?? EN[key] ?? HARDCODED[key] ?? ''
  }
  return EN[key] ?? HARDCODED[key] ?? ''
}

/** `t` with `%s`-style positional substitution, for the few keys that take one. */
export function tf(key: string, ...args: (string | number)[]): string {
  let i = 0
  return t(key).replace(/%s/g, () => String(args[i++] ?? ''))
}

/** `number_format($n)`: grouped, no decimals, and floored first because PHP's
 *  number_format rounds where every caller here has already truncated. */
export function num(value: number): string {
  return Math.floor(value).toLocaleString(numberLocale())
}

/** `number_format($n, 1)`, for the production and rate readouts. */
export function dec(value: number, places = 1): string {
  return value.toLocaleString(numberLocale(), {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

function numberLocale(): string {
  return locale === 'tr' ? 'tr-TR' : 'en-US'
}
