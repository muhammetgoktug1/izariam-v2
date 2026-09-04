/**
 * GET /api/map -- islands inside a viewport, for the isometric world map.
 *
 * Replaces actions/getJSONArea (izariam/controllers/actions.php:1512-1537),
 * which ran one unindexed SELECT per x-column -- about 19 per pan -- and built
 * its JSON by string concatenation, unescaped, so an island name containing a
 * quote produced invalid JSON. Here it is one indexed query over
 * islands(x, y).
 *
 * The legacy also compared with strict inequalities on y, silently omitting
 * the boundary rows the client asked for. This returns the inclusive range.
 */

import { mapAreaSchema } from '@izariam/shared'
import { Router } from 'express'

import { pool } from '../db.js'

export const mapRouter: Router = Router()

const AREA_SQL = `
  select i.id, i.name, i.x, i.y, i.type, i.trade_resource, i.wonder,
         (select count(*)::int from towns t where t.island_id = i.id) as town_count
  from islands i
  where i.x between $1 and $2 and i.y between $3 and $4
  order by i.x, i.y
`

/** A pan requests roughly 19x19 tiles; anything larger is a scraper. */
const MAX_SPAN = 40

mapRouter.get('/map', async (req, res) => {
  const parsed = mapAreaSchema.safeParse({
    xMin: Number(req.query.xMin),
    xMax: Number(req.query.xMax),
    yMin: Number(req.query.yMin),
    yMax: Number(req.query.yMax),
  })
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_area', detail: parsed.error.issues })
    return
  }
  const { xMin, xMax, yMin, yMax } = parsed.data
  if (xMax - xMin > MAX_SPAN || yMax - yMin > MAX_SPAN || xMax < xMin || yMax < yMin) {
    res.status(400).json({ error: 'area_too_large' })
    return
  }

  const { rows } = await pool.query(AREA_SQL, [xMin, xMax, yMin, yMax])
  res.json({
    request: { xMin, xMax, yMin, yMax },
    islands: rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      x: Number(r.x),
      y: Number(r.y),
      type: Number(r.type),
      tradeResource: Number(r.trade_resource),
      wonder: Number(r.wonder),
      townCount: Number(r.town_count),
    })),
  })
})
