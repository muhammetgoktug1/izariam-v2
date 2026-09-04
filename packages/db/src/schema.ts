/**
 * Postgres schema for iZariam.
 *
 * Derived from the legacy MyISAM schema (izariam/database/alpha.sql, 15 tables
 * / 340 columns) with the repeated column groups normalised away -- 207 of
 * those 340 columns were positional repetitions (`city0..city16`,
 * `pos0_type..pos14_level`, `res1_1..res4_14`, 23 unit counters duplicated
 * across `army` and `missions`, and so on).
 *
 * Three classes of legacy defect are fixed here rather than in code:
 *   - quantities stored as varchar(255) / float(11,0)  -> numeric
 *   - unix epoch in int(11) (overflows in 2038)        -> timestamptz
 *   - island slot claimed via a check-then-set race    -> unique(island, slot)
 * The legacy had zero secondary indexes; the ones added below come from the
 * query shapes that actually run on every request.
 */

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

/** Resource / population quantities. The tick accumulates fractions of a unit
 *  per second, so these cannot be integers. */
const qty = (name: string) => numeric(name, { precision: 20, scale: 6 })

export const resourceKind = pgEnum('resource_kind', [
  'wood',
  'wine',
  'marble',
  'crystal',
  'sulfur',
])

/** 1 = colonise, 2 = transport, 3 = buy, 4 = sell (legacy `mission_type`).
 *  5 and 6 are reserved for the attack/plunder missions that the legacy
 *  codebase declares in its UI but never implements. */
export const missionKind = pgEnum('mission_kind', [
  'colonise',
  'transport',
  'buy',
  'sell',
  'attack',
  'plunder',
])

export const unitQueueKind = pgEnum('unit_queue_kind', ['land', 'naval'])

export const tradeDirection = pgEnum('trade_direction', ['buy', 'sell'])

/** Facets of the legacy `users.points_*` block. */
export const scoreCategory = pgEnum('score_category', [
  'total',
  'buildings',
  'levels',
  'peoples',
  'research',
  'complete',
  'army',
  'gold',
  'transports',
])

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    login: varchar('login', { length: 30 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull(),

    /** argon2id. The legacy stored an unsalted md5 (player_model.php:265). */
    passwordHash: text('password_hash').notNull(),
    /** Set only for accounts carried over by the migration; cleared on the
     *  first successful login once the argon2id hash has been written. */
    legacyPasswordMd5: varchar('legacy_password_md5', { length: 32 }),

    accessLevel: smallint('access_level').notNull().default(0),
    registerKey: varchar('register_key', { length: 64 }),
    registerComplete: boolean('register_complete').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastVisitAt: timestamp('last_visit_at', { withTimezone: true }),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    blockedReason: text('blocked_reason'),

    /** Nullable during registration: the first town does not exist yet. */
    currentTownId: integer('current_town_id'),
    capitalTownId: integer('capital_town_id'),

    gold: qty('gold').notNull().default('100'),
    ambrosia: integer('ambrosia').notNull().default(1000),
    transports: integer('transports').notNull().default(0),
    researchPoints: qty('research_points').notNull().default('0'),

    tutorialStep: smallint('tutorial_step').notNull().default(0),
    optionsSelect: smallint('options_select').notNull().default(1),

    /** Each premium boost is an expiry instant; NULL = not active. */
    premiumAccountUntil: timestamp('premium_account_until', { withTimezone: true }),
    premiumWoodUntil: timestamp('premium_wood_until', { withTimezone: true }),
    premiumWineUntil: timestamp('premium_wine_until', { withTimezone: true }),
    premiumMarbleUntil: timestamp('premium_marble_until', { withTimezone: true }),
    premiumCrystalUntil: timestamp('premium_crystal_until', { withTimezone: true }),
    premiumSulfurUntil: timestamp('premium_sulfur_until', { withTimezone: true }),
    premiumCapacityUntil: timestamp('premium_capacity_until', { withTimezone: true }),
  },
  (t) => [
    index('users_login_idx').on(t.login),
    /**
     * Registration and login both look an account up with `lower(login)`, but
     * the `unique` on the column itself is case-sensitive, so `Alice` and
     * `alice` could both be created and the login query would then return two
     * rows and silently take the first. The legacy had the opposite problem
     * and the opposite luck: no unique index at all, but a utf8_general_ci
     * collation that made its comparisons case-insensitive anyway.
     */
    uniqueIndex('users_login_lower_unique').on(sql`lower(${t.login})`),
  ],
)

/** Replaces users.points, points_buildings, ... (9 float(11,0) columns).
 *  Highscore ordering reads this, hence the descending value index. */
export const userScores = pgTable(
  'user_scores',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: scoreCategory('category').notNull(),
    value: qty('value').notNull().default('0'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.category] }),
    index('user_scores_rank_idx').on(t.category, sql`${t.value} DESC`),
  ],
)

export const notes = pgTable('notes', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull().default(''),
})

/** Replaces the 59 `res{branch}_{node}` columns on the legacy research table.
 *  Absent row == level 0. */
export const userResearch = pgTable(
  'user_research',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branch: smallint('branch').notNull(),
    node: smallint('node').notNull(),
    level: smallint('level').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branch, t.node] })],
)

/** The legacy `way{n}_checked` flags: whether the player has acknowledged the
 *  newest unlock in a research branch. */
export const userResearchBranchSeen = pgTable(
  'user_research_branch_seen',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branch: smallint('branch').notNull(),
    seen: boolean('seen').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branch] })],
)

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export const islands = pgTable(
  'islands',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    type: smallint('type').notNull().default(1),
    /** 0 = wood, 1 = wine, 2 = marble, 3 = crystal, 4 = sulfur. */
    tradeResource: smallint('trade_resource').notNull().default(3),
    wonder: smallint('wonder').notNull().default(0),

    woodLevel: smallint('wood_level').notNull().default(1),
    tradeLevel: smallint('trade_level').notNull().default(1),
    woodDonated: qty('wood_donated').notNull().default('0'),
    tradeDonated: qty('trade_donated').notNull().default('0'),
    woodUpgradeStartedAt: timestamp('wood_upgrade_started_at', { withTimezone: true }),
    tradeUpgradeStartedAt: timestamp('trade_upgrade_started_at', { withTimezone: true }),

    /**
     * The monument, 1..5. Every island starts at 1: the wonder itself is not
     * built, only expanded.
     *
     * These six columns are written **only** by the donateWonder route, inside
     * a transaction holding `select … for update` on this row --
     * `savePlayerState` deliberately leaves them out of its island UPDATE (see
     * the comment there). The island row is shared by up to seventeen players,
     * and that UPDATE is a blind write of a copy read before any lock.
     */
    wonderLevel: smallint('wonder_level').notNull().default(1),
    /** Donated toward the next expansion. The island's own trade good is never
     *  accepted, so one of these four stays at zero forever. */
    wonderWineDonated: qty('wonder_wine_donated').notNull().default('0'),
    wonderMarbleDonated: qty('wonder_marble_donated').notNull().default('0'),
    wonderCrystalDonated: qty('wonder_crystal_donated').notNull().default('0'),
    wonderSulfurDonated: qty('wonder_sulfur_donated').notNull().default('0'),
  },
  (t) => [
    // The world map fetches a viewport column-by-column; the legacy fired one
    // unindexed full scan per x-column, 19 per pan (actions.php:1518).
    index('islands_xy_idx').on(t.x, t.y),
    unique('islands_xy_unique').on(t.x, t.y),
  ],
)

/**
 * Replaces `islands.city0..city16`. `slot` is the position on the island;
 * only even slots 0..14 are offered at registration, odd slots are reachable
 * by relocation, and legacy `city15`/`city16` were dead columns.
 *
 * The unique constraint is the whole point: the legacy claimed a slot with a
 * SELECT followed by an unguarded UPDATE (main.php:126 -> :147), so two
 * concurrent registrations could take the same slot and orphan a town.
 */
export const towns = pgTable(
  'towns',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    islandId: integer('island_id')
      .notNull()
      .references(() => islands.id),
    slot: smallint('slot').notNull(),
    name: varchar('name', { length: 64 }).notNull().default('Polis'),

    /** Watermark the lazy tick advances from. */
    lastUpdate: timestamp('last_update', { withTimezone: true }).notNull().defaultNow(),

    wood: qty('wood').notNull().default('500'),
    wine: qty('wine').notNull().default('0'),
    marble: qty('marble').notNull().default('0'),
    crystal: qty('crystal').notNull().default('0'),
    sulfur: qty('sulfur').notNull().default('0'),

    /** Unassigned citizens. Assigned ones live in the columns below. */
    peoples: qty('peoples').notNull().default('40'),
    workers: qty('workers').notNull().default('0'),
    tradegood: qty('tradegood').notNull().default('0'),
    scientists: qty('scientists').notNull().default('0'),
    templer: qty('templer').notNull().default('0'),

    spies: smallint('spies').notNull().default(0),
    spyTrainingStartedAt: timestamp('spy_training_started_at', { withTimezone: true }),

    /** Wood donated by this town toward its island's two resource nodes. */
    workersWood: qty('workers_wood').notNull().default('0'),
    tradegoodWood: qty('tradegood_wood').notNull().default('0'),
    /** Luxury goods this town has given to its island's monument, the three
     *  added together -- the wonder roster shows one figure per town. */
    wonderDonated: qty('wonder_donated').notNull().default('0'),

    actionPoints: smallint('action_points').notNull().default(3),
    tavernWine: smallint('tavern_wine').notNull().default(0),

    branchSearchDirection: tradeDirection('branch_search_direction'),
    branchSearchResource: resourceKind('branch_search_resource'),
    branchSearchRadius: smallint('branch_search_radius').notNull().default(1),
  },
  (t) => [
    unique('towns_island_slot_unique').on(t.islandId, t.slot),
    index('towns_user_idx').on(t.userId),
    index('towns_island_idx').on(t.islandId),
  ],
)

/** Replaces `towns.pos0_type/pos0_level .. pos14_type/pos14_level` (30 cols).
 *  Absent row == empty building ground. */
export const townBuildings = pgTable(
  'town_buildings',
  {
    townId: integer('town_id')
      .notNull()
      .references(() => towns.id, { onDelete: 'cascade' }),
    slot: smallint('slot').notNull(),
    type: smallint('type').notNull(),
    level: smallint('level').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.townId, t.slot] })],
)

/** Replaces the `towns.build_line` CSV blob ("pos,type;pos,type"). Ordered by
 *  `position`; `startedAt` is set on the head of the queue only, matching the
 *  legacy single `build_start` timestamp. */
export const buildQueue = pgTable(
  'build_queue',
  {
    id: serial('id').primaryKey(),
    townId: integer('town_id')
      .notNull()
      .references(() => towns.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    slot: smallint('slot').notNull(),
    type: smallint('type').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
  },
  (t) => [
    unique('build_queue_town_position_unique').on(t.townId, t.position),
    index('build_queue_town_idx').on(t.townId),
  ],
)

/** Replaces the 23 unit counter columns on the legacy `army` table.
 *  unitType is 1..23 as used by gamedata/units.json. */
export const armyUnits = pgTable(
  'army_units',
  {
    townId: integer('town_id')
      .notNull()
      .references(() => towns.id, { onDelete: 'cascade' }),
    unitType: smallint('unit_type').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.townId, t.unitType] })],
)

/** Replaces the `army.army_line` / `army.ships_line` CSV blobs. */
export const unitQueue = pgTable(
  'unit_queue',
  {
    id: serial('id').primaryKey(),
    townId: integer('town_id')
      .notNull()
      .references(() => towns.id, { onDelete: 'cascade' }),
    kind: unitQueueKind('kind').notNull(),
    position: smallint('position').notNull(),
    unitType: smallint('unit_type').notNull(),
    count: integer('count').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
  },
  (t) => [
    unique('unit_queue_town_kind_position_unique').on(t.townId, t.kind, t.position),
    index('unit_queue_town_idx').on(t.townId),
  ],
)

/** Replaces `towns.branch_trade_{resource}_{type,count,cost}` (15 cols).
 *  One row per resource the town posts an offer for. */
export const branchOffers = pgTable(
  'branch_offers',
  {
    townId: integer('town_id')
      .notNull()
      .references(() => towns.id, { onDelete: 'cascade' }),
    resource: resourceKind('resource').notNull(),
    direction: tradeDirection('direction').notNull(),
    count: qty('count').notNull().default('0'),
    price: qty('price').notNull().default('0'),
  },
  (t) => [
    primaryKey({ columns: [t.townId, t.resource] }),
    // Cross-player market scan (legacy did this from inside a view,
    // views/view/branchOffice.php:112).
    index('branch_offers_market_idx').on(t.resource, t.direction, t.price),
  ],
)

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

export const missions = pgTable(
  'missions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromTownId: integer('from_town_id')
      .notNull()
      .references(() => towns.id, { onDelete: 'cascade' }),
    /** Null while a colonisation mission is in flight: the target town does
     *  not exist until the fleet lands. */
    toTownId: integer('to_town_id').references(() => towns.id, { onDelete: 'cascade' }),
    kind: missionKind('kind').notNull(),

    loadingFromStartedAt: timestamp('loading_from_started_at', { withTimezone: true }),
    loadingToStartedAt: timestamp('loading_to_started_at', { withTimezone: true }),
    departedAt: timestamp('departed_at', { withTimezone: true }),
    returnStartedAt: timestamp('return_started_at', { withTimezone: true }),
    /** Precomputed so a worker can find due missions without replaying rules. */
    arrivesAt: timestamp('arrives_at', { withTimezone: true }),
    /** Fraction of the outbound leg already flown when the fleet was recalled. */
    abortPercent: numeric('abort_percent', { precision: 6, scale: 4 }).notNull().default('0'),

    transports: integer('transports').notNull().default(0),
    wood: qty('wood').notNull().default('0'),
    wine: qty('wine').notNull().default('0'),
    marble: qty('marble').notNull().default('0'),
    crystal: qty('crystal').notNull().default('0'),
    sulfur: qty('sulfur').notNull().default('0'),
    gold: qty('gold').notNull().default('0'),
    peoples: qty('peoples').notNull().default('0'),
  },
  (t) => [
    index('missions_from_idx').on(t.fromTownId),
    index('missions_to_idx').on(t.toTownId),
    index('missions_user_idx').on(t.userId),
    // Drives the arrival worker.
    index('missions_arrives_idx').on(t.arrivesAt),
  ],
)

/** Replaces the 23 unit columns duplicated from `army` onto `missions`. */
export const missionUnits = pgTable(
  'mission_units',
  {
    missionId: integer('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    unitType: smallint('unit_type').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.missionId, t.unitType] })],
)

/** Replaces `missions.trade_{resource}_{count,cost}` (11 cols): the agreed
 *  terms of a buy/sell mission against a branch office. */
export const missionTradeTerms = pgTable(
  'mission_trade_terms',
  {
    missionId: integer('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    resource: resourceKind('resource').notNull(),
    count: qty('count').notNull().default('0'),
    price: qty('price').notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.missionId, t.resource] })],
)

export const tradeRoutes = pgTable(
  'trade_routes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromTownId: integer('from_town_id').references(() => towns.id, { onDelete: 'set null' }),
    toTownId: integer('to_town_id').references(() => towns.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Next 24h cycle boundary. The tick replays every missed cycle. */
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    resource: resourceKind('resource').notNull(),
    sendCount: qty('send_count').notNull().default('0'),
    sendTime: integer('send_time').notNull().default(0),
  },
  (t) => [
    index('trade_routes_user_idx').on(t.userId),
    index('trade_routes_next_run_idx').on(t.nextRunAt),
  ],
)

export const spies = pgTable(
  'spies',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromTownId: integer('from_town_id')
      .notNull()
      .references(() => towns.id, { onDelete: 'cascade' }),
    toTownId: integer('to_town_id').references(() => towns.id, { onDelete: 'cascade' }),
    /** Accumulated detection risk, carried across missions. */
    risk: numeric('risk', { precision: 8, scale: 4 }).notNull().default('0'),
    missionType: smallint('mission_type').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    lastUpdate: timestamp('last_update', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('spies_from_idx').on(t.fromTownId),
    index('spies_user_idx').on(t.userId),
  ],
)

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

/** System notices addressed to one of a player's towns (production finished,
 *  fleet arrived, island upgraded). */
export const townMessages = pgTable(
  'town_messages',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    townId: integer('town_id').references(() => towns.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Structured payload rather than the legacy pre-rendered HTML blob, so
     *  the client can localise it. */
    kind: varchar('kind', { length: 48 }).notNull(),
    params: text('params').notNull().default('{}'),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('town_messages_user_created_idx').on(t.userId, t.createdAt)],
)

export const spyMessages = pgTable(
  'spy_messages',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spyId: integer('spy_id'),
    fromTownId: integer('from_town_id').references(() => towns.id, { onDelete: 'set null' }),
    toTownId: integer('to_town_id').references(() => towns.id, { onDelete: 'set null' }),
    missionType: smallint('mission_type').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    summary: text('summary').notNull().default(''),
    /** Espionage result payload. */
    report: text('report').notNull().default('{}'),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('spy_messages_user_created_idx').on(t.userId, t.createdAt)],
)

/** Player-to-player mail. */
export const userMessages = pgTable(
  'user_messages',
  {
    id: serial('id').primaryKey(),
    fromUserId: integer('from_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: smallint('kind').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    body: text('body').notNull(),
  },
  (t) => [index('user_messages_from_created_idx').on(t.fromUserId, t.createdAt)],
)

/** Replaces `user_messages.{checked,deleted,archived}_{from,to}` -- per-side
 *  state that only worked because a message had exactly two participants. */
export const messageRecipients = pgTable(
  'message_recipients',
  {
    messageId: integer('message_id')
      .notNull()
      .references(() => userMessages.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'to' for the addressee, 'from' for the sender's outbox copy. */
    side: varchar('side', { length: 4 }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    deleted: boolean('deleted').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.side] }),
    index('message_recipients_inbox_idx').on(t.userId, t.side, t.deleted),
  ],
)

// ---------------------------------------------------------------------------
// Reserved
// ---------------------------------------------------------------------------

/**
 * Combat does not exist in the legacy codebase: wall_data_by_level() is
 * defined but never called, the defence/health/ability unit columns are never
 * read, there is no actions/plunder handler, and the combat-report view is
 * hardcoded to render zero reports. The table is created so the schema does
 * not have to change when combat is designed; nothing writes to it yet.
 */
export const combatReports = pgTable(
  'combat_reports',
  {
    id: serial('id').primaryKey(),
    attackerUserId: integer('attacker_user_id').references(() => users.id, { onDelete: 'set null' }),
    defenderUserId: integer('defender_user_id').references(() => users.id, { onDelete: 'set null' }),
    townId: integer('town_id').references(() => towns.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    report: text('report').notNull().default('{}'),
  },
  (t) => [index('combat_reports_town_idx').on(t.townId)],
)

// ---------------------------------------------------------------------------
// Miracles
// ---------------------------------------------------------------------------

/**
 * A miracle a player has called from an island's wonder.
 *
 * The legacy has no table for this because it has no miracles -- only the
 * texts describing them. One row per (player, island): calling again overwrites
 * it, and `activated_at` alone answers both "is the effect still running" and
 * "may it be called again", since the duration and the cooldown are properties
 * of the wonder type (rules/temple.ts).
 */
export const miracleActivations = pgTable(
  'miracle_activations',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    islandId: integer('island_id')
      .notNull()
      .references(() => islands.id, { onDelete: 'cascade' }),
    /** Copied from `islands.wonder` at activation: the row must keep meaning
     *  the same thing even if the island's wonder is ever re-rolled. */
    wonder: smallint('wonder').notNull(),
    /** 1..5, whichever the island's faith unlocked at the time. */
    level: smallint('level').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('miracle_activations_user_island_unique').on(t.userId, t.islandId),
    index('miracle_activations_user_idx').on(t.userId),
  ],
)

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
)

/**
 * Password reset tickets.
 *
 * The legacy had no such thing: `action=sendPassword`
 * (izariam/controllers/main.php:206-251) took an email address, generated an
 * eight-character password, wrote `md5()` of it straight onto the account and
 * mailed the plaintext. No token, no confirmation, no expiry -- knowing
 * somebody's email address was enough to lock them out of their account.
 *
 * Here the ticket is a random token; only its sha-256 is stored, so a leaked
 * database row cannot be replayed. Single use, and short-lived.
 */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    index('password_resets_user_idx').on(t.userId),
    index('password_resets_expires_idx').on(t.expiresAt),
  ],
)

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

/**
 * Panel staff, deliberately a second identity rather than a flag on `users`.
 *
 * The legacy's answer was `users.access_level` (alpha.sql:663), a column it
 * created and then never read -- `view/admin.php` is a zero-byte file and
 * `game.php:65` renders it with no access check at all. Sharing the player row
 * would mean one password, one session table and one ban column doing two jobs;
 * keeping them apart makes "a player session reaching an admin route"
 * unrepresentable instead of something a query has to remember to filter.
 */
export const adminRole = pgEnum('admin_role', ['super_admin'])

export const adminUsers = pgTable(
  'admin_users',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 80 }).notNull().default(''),
    /** argon2id, the same parameters as `users.password_hash`. */
    passwordHash: text('password_hash').notNull(),
    role: adminRole('role').notNull().default('super_admin'),
    /** Soft disable. `requireAdmin` re-reads it on every request, so clearing
     *  this locks the account out immediately rather than at the next login. */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    /** Identity is the address, so it is unique case-insensitively -- the same
     *  shape as `users_login_lower_unique`, and for the same reason. */
    uniqueIndex('admin_users_email_lower_unique').on(sql`lower(${t.email})`),
  ],
)

/**
 * Deliberately not `sessions`.
 *
 * That table's `user_id` is a NOT NULL foreign key into `users`; holding both
 * kinds would make it nullable plus a check constraint, and `requireSession`'s
 * lookup has no kind filter -- one forgotten `and kind = 'player'` and an admin
 * session id would authenticate as whichever player shares its number. Two
 * tables means the two id spaces simply never meet.
 */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('admin_sessions_user_idx').on(t.adminUserId),
    index('admin_sessions_expires_idx').on(t.expiresAt),
  ],
)

/**
 * Who did what from the panel.
 *
 * Written in the same transaction as the change it records. Retrofitting this
 * later would mean revisiting every handler, and the history it would have held
 * is not recoverable -- so the table exists from the first commit even though
 * nothing reads it yet.
 *
 * `admin_user_id` survives the account being deleted (`set null`): the point of
 * the log is that the record outlives the actor.
 */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: serial('id').primaryKey(),
    adminUserId: integer('admin_user_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    /** `player.ban`, `player.create`, `admin.delete`, ... */
    action: varchar('action', { length: 40 }).notNull(),
    targetType: varchar('target_type', { length: 20 }).notNull(),
    targetId: integer('target_id'),
    /** JSON, as text: the payload shape differs per action and nothing queries
     *  into it. Never holds a password or a token. */
    meta: text('meta').notNull().default('{}'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('admin_audit_log_created_idx').on(t.createdAt)],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many, one }) => ({
  towns: many(towns),
  research: many(userResearch),
  scores: many(userScores),
  notes: one(notes, { fields: [users.id], references: [notes.userId] }),
  missions: many(missions),
  tradeRoutes: many(tradeRoutes),
  spies: many(spies),
}))

export const islandsRelations = relations(islands, ({ many }) => ({
  towns: many(towns),
}))

export const townsRelations = relations(towns, ({ one, many }) => ({
  user: one(users, { fields: [towns.userId], references: [users.id] }),
  island: one(islands, { fields: [towns.islandId], references: [islands.id] }),
  buildings: many(townBuildings),
  buildQueue: many(buildQueue),
  army: many(armyUnits),
  unitQueue: many(unitQueue),
  branchOffers: many(branchOffers),
}))

export const missionsRelations = relations(missions, ({ one, many }) => ({
  user: one(users, { fields: [missions.userId], references: [users.id] }),
  fromTown: one(towns, { fields: [missions.fromTownId], references: [towns.id] }),
  units: many(missionUnits),
  tradeTerms: many(missionTradeTerms),
}))
