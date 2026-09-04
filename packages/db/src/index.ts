import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './schema.js'

export * from './schema.js'
export { schema }

/**
 * numeric columns come back from pg as strings by default so large values are
 * not silently truncated. Every numeric in this schema is a game quantity that
 * comfortably fits a double, and the rules engine works in numbers, so parse
 * them at the driver boundary instead of sprinkling Number() over the code.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v))
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v))

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set')
  return new pg.Pool({ connectionString: url })
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema })
}

export type Database = ReturnType<typeof createDb>
