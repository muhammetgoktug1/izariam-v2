/**
 * Seed the world, and the one account that can administer it.
 *
 * The only reference data the legacy shipped is the 200-island map in
 * izariam/database/alpha.sql; everything else (building costs, unit stats,
 * research) lived in PHP switch statements and now lives in @izariam/gamedata.
 *
 * Idempotent, and it has to be: the `migrate` compose service runs this on
 * every `docker compose up`. Islands are matched on their (x, y) coordinate,
 * which the schema enforces as unique; the super admin is insert-if-absent, so
 * a password changed from the panel is never silently reverted.
 *
 * Run with:  npm run -w @izariam/db seed
 */

import { ISLANDS_SEED } from '@izariam/gamedata'
import argon2 from 'argon2'
import { sql } from 'drizzle-orm'

import { createDb, createPool } from './index.js'
import type { Database } from './index.js'
import { adminUsers, islands } from './schema.js'

/**
 * The seeded super admin.
 *
 * These are development credentials and they are in the repository, which is
 * why `seedSuperAdmin` refuses to plant the default password on a production
 * database. Anything that is not a laptop sets the two environment variables.
 */
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'admin@izariam.local'
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? '1q2w3e4r*-'
const ADMIN_NAME = process.env.ADMIN_SEED_NAME ?? 'Süper Yönetici'

async function seedIslands(db: Database) {
  const rows = ISLANDS_SEED.map((i) => ({
    name: String(i.name),
    x: Number(i.x),
    y: Number(i.y),
    type: Number(i.type),
    tradeResource: Number(i.trade_resource),
    wonder: Number(i.wonder),
    woodLevel: Number(i.wood_level ?? 1),
    tradeLevel: Number(i.trade_level ?? 1),
  }))

  await db
    .insert(islands)
    .values(rows)
    .onConflictDoUpdate({
      target: [islands.x, islands.y],
      set: {
        name: sql`excluded.name`,
        type: sql`excluded.type`,
        tradeResource: sql`excluded.trade_resource`,
        wonder: sql`excluded.wonder`,
      },
    })

  const counted = await db.select({ count: sql<number>`count(*)::int` }).from(islands)
  console.log(`islands: ${counted[0]?.count ?? 0}`)
}

/**
 * Insert-if-absent, never upsert.
 *
 * An upsert would rewrite the password hash on every `docker compose up`,
 * quietly undoing a password the staff changed from the panel. The pre-check is
 * a courtesy for the log line; `admin_users_email_lower_unique` is what
 * actually decides, so a concurrent seed lands as a no-op rather than a crash.
 */
async function seedSuperAdmin(db: Database) {
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_SEED_PASSWORD) {
    console.log('admin: skipped (set ADMIN_SEED_PASSWORD to seed in production)')
    return
  }

  const existing = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(sql`lower(${adminUsers.email}) = lower(${ADMIN_EMAIL})`)
    .limit(1)
  if (existing.length > 0) {
    console.log(`admin: ${ADMIN_EMAIL} already present`)
    return
  }

  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id })
  await db
    .insert(adminUsers)
    .values({
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      passwordHash,
      role: 'super_admin',
    })
    // No conflict target: drizzle cannot name an expression index, and a bare
    // DO NOTHING covers every constraint on the table.
    .onConflictDoNothing()
  console.log(`admin: seeded ${ADMIN_EMAIL}`)
}

async function main() {
  const pool = createPool()
  const db = createDb(pool)

  await seedIslands(db)
  await seedSuperAdmin(db)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
