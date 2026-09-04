import pg from 'pg'

/**
 * numeric and int8 arrive as strings by default so large values are not
 * silently truncated. Every numeric in this schema is a game quantity that
 * fits a double comfortably, and the rules engine works in numbers, so they
 * are parsed once here rather than at every call site.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v))
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v))

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://izariam:izariam@127.0.0.1:5432/izariam',
  max: Number(process.env.PG_POOL_MAX ?? 10),
})

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * Every mutation goes through this. The legacy had none: `grep trans_start`
 * over the whole application returns nothing, so a failure mid-action left
 * resources debited with nothing to show for them.
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}
