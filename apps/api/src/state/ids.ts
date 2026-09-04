/**
 * Identity for rows the rules create.
 *
 * The rules default to `max(id) + 1` over the rows they happen to be holding
 * (trade.ts:78). That is only safe if the state graph contains every row the id
 * space can collide with, and it never does: it holds one player's missions out
 * of the whole world's. Two players colonising in the same second both pick the
 * same "next" id.
 *
 * Two different problems, two answers:
 *
 * - A mission or trade route is referenced by nothing else, so it does not need
 *   a real id until it is written. It gets a negative placeholder, unique
 *   within the request, which `savePlayerState` reads as "INSERT me" and
 *   replaces with the sequence value (save.ts:302).
 * - A town is referenced immediately -- the colonisation mission points at it
 *   and it takes an island slot -- so its id has to be real before the action
 *   runs. That one comes from the sequence up front.
 */

import type { Queryable } from './load.js'

/**
 * Placeholder ids for rows that will be INSERTed. Counts down from -1 so each
 * is distinct within the request and none can be mistaken for a stored id.
 */
export function transientIds(): () => number {
  let next = 0
  return () => --next
}

/**
 * Reserve a real town id. Burns the value even if the transaction rolls back,
 * which is what sequences are for -- gaps are free, collisions are not.
 */
export async function allocateTownId(client: Queryable): Promise<number> {
  const { rows } = await client.query(
    `select nextval(pg_get_serial_sequence('towns', 'id')) as id`,
    [],
  )
  return Number(rows[0].id)
}
