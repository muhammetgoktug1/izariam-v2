/**
 * The isometric world map.
 *
 * Replaces the hand-rolled engine that lived as ~880 lines of inline
 * JavaScript inside izariam/views/sidebox/worldmap_iso.php (a `Map` class with
 * 24 methods) plus 1,042 lines of literally repeated <div> markup in
 * views/view/worldmap_iso.php. No library was involved then and none is now --
 * the projection is four lines of arithmetic.
 *
 * The geometry is preserved exactly, because design/skin/ik_worldmap_iso_*.css
 * is reused verbatim and its sprites are cut for these tile dimensions:
 *
 *   left    = (x - y) * 120px
 *   top     = (x + y) * 60px
 *   z-index = 100 + x + y
 *
 * a 2:1 diamond lattice of 240x120 tiles. Dragging moves the whole plane;
 * crossing a tile boundary in isometric space pulls in the next ring of
 * islands. The legacy kept a second, parallel layer of invisible hit boxes
 * (`#linkMap`) moved in lockstep -- that is not needed here, since React
 * attaches handlers to the tiles themselves.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { MapIsland } from '@izariam/shared'

import { api } from '../lib/api.js'
import { hashFor } from '../lib/routes.js'
import type { Screen } from './context.js'

const TILE_W = 240
const TILE_H = 120
const HALF_W = TILE_W / 2
const HALF_H = TILE_H / 2

/** How many tiles beyond the viewport to request, matching the legacy's +-4. */
const PREFETCH = 4
const VIEW_TILES = 5

/** Pixels of travel before a pointer gesture counts as a pan, not a click. */
const DRAG_THRESHOLD = 4

interface Props {
  /** Island the player is currently looking at. */
  centre: { x: number; y: number }
  onOpenIsland: (islandId: number) => void
}

/**
 * The routed screen. `game/worldmap_iso/{x}/{y}` centres on a coordinate; with
 * no parameters it centres on the player's own island, which is what the
 * toolbar's world button links to.
 */
export const WorldMapScreen: Screen = ({ ctx, sideboxes }) => {
  const [x, y] = ctx.route.params
  const centre = x || y ? { x, y } : { x: ctx.island.x, y: ctx.island.y }
  return (
    <>
      {sideboxes}
      <WorldMap centre={centre} onOpenIsland={(id) => ctx.navigate(hashFor('island', id))} />
    </>
  )
}

/** Screen offset -> the isometric coordinate under it. */
function screenToIso(dx: number, dy: number): { x: number; y: number } {
  return {
    x: Math.round(dy / TILE_H + dx / TILE_W),
    y: Math.round(dy / TILE_H - dx / TILE_W),
  }
}

/**
 * Ocean tile variant. Ported verbatim from getOceanClass
 * (izariam/views/sidebox/worldmap_iso.php:660-669) -- the skin only defines
 * ocean1..3 and ocean_feature1..4, so an invented `ocean4` renders nothing.
 * Later tests win, exactly as the original's fall-through assignments do.
 */
function oceanClass(x: number, y: number): string {
  let cls = 'ocean1'
  if (Math.abs((x + y * 3) % 4) === 0) cls = 'ocean2'
  if (Math.abs((x + y * 4) % 5) === 0) cls = 'ocean3'
  if (Math.abs((x + y * 5) % 12) === 0) cls = 'ocean_feature1'
  if (Math.abs((x + y * 6) % 13) === 0) cls = 'ocean_feature2'
  if (Math.abs((x + y * 7) % 12) === 0) cls = 'ocean_feature3'
  if (Math.abs((x + y * 8) % 13) === 0) cls = 'ocean_feature4'
  return cls
}

export function WorldMap({ centre, onOpenIsland }: Props) {
  const [origin, setOrigin] = useState(centre)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  // Mirrors `offset` so the pointerup handler can read the latest value
  // without re-creating itself on every move.
  const offsetRef = useRef(offset)
  const dragRef = useRef<{ startX: number; startY: number; base: { x: number; y: number } } | null>(
    null,
  )
  // Set once a pointer travels far enough to count as a pan, so the click
  // that ends the drag does not also open whatever island is under it.
  const draggedRef = useRef(false)

  // The map follows the town the player switches to. `useState(centre)`
  // captures the prop once, so without this the view stays on the old island.
  useEffect(() => {
    setOrigin(centre)
    setOffset({ x: 0, y: 0 })
    offsetRef.current = { x: 0, y: 0 }
  }, [centre.x, centre.y])

  const area = useMemo(
    () => ({
      xMin: origin.x - VIEW_TILES - PREFETCH,
      xMax: origin.x + VIEW_TILES + PREFETCH,
      yMin: origin.y - VIEW_TILES - PREFETCH,
      yMax: origin.y + VIEW_TILES + PREFETCH,
    }),
    [origin],
  )

  const islands = useQuery({
    queryKey: ['map', area],
    queryFn: () => api.map(area),
    // Islands change only when someone colonises, so a short cache is plenty
    // and panning back over ground already seen costs nothing.
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })

  const byCoord = useMemo(() => {
    const m = new Map<string, MapIsland>()
    for (const i of islands.data?.islands ?? []) m.set(`${i.x},${i.y}`, i)
    return m
  }, [islands.data])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      draggedRef.current = false
      dragRef.current = { startX: e.clientX, startY: e.clientY, base: offset }
    },
    [offset],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) draggedRef.current = true
    const next = { x: drag.base.x + dx, y: drag.base.y + dy }
    offsetRef.current = next
    setOffset(next)
  }, [])

  /**
   * Rebase once the drag ends rather than during it. Shifting the origin
   * mid-drag would be immediately overwritten by the next pointermove (which
   * recomputes the offset from the value captured at pointerdown), so the map
   * would visibly stutter.
   *
   * Moving the origin by `moved` in iso space displaces every tile by
   * ((mx - my) * HALF_W, (mx + my) * HALF_H) on screen, so the offset gains
   * exactly that to keep the picture still. Derived from the current offset
   * the two cancel, which is what returns the plane to rest.
   */
  const onPointerUp = useCallback(() => {
    dragRef.current = null
    const current = offsetRef.current
    const moved = screenToIso(-current.x, -current.y)
    if (moved.x === 0 && moved.y === 0) return
    const settled = {
      x: current.x + (moved.x - moved.y) * HALF_W,
      y: current.y + (moved.x + moved.y) * HALF_H,
    }
    offsetRef.current = settled
    setOrigin((o) => ({ x: o.x + moved.x, y: o.y + moved.y }))
    setOffset(settled)
  }, [])

  const tiles = []
  for (let dy = -VIEW_TILES; dy <= VIEW_TILES; dy++) {
    for (let dx = -VIEW_TILES; dx <= VIEW_TILES; dx++) {
      const x = origin.x + dx
      const y = origin.y + dy
      const island = byCoord.get(`${x},${y}`)
      tiles.push(
        <div
          key={`${x},${y}`}
          id={`tile_${x}_${y}`}
          className={island ? `island${island.type}` : oceanClass(x, y)}
          style={{
            position: 'absolute',
            width: TILE_W,
            height: TILE_H,
            left: (dx - dy) * HALF_W,
            top: (dx + dy) * HALF_H,
            zIndex: 100 + x + y,
          }}
          onClick={() => {
            if (draggedRef.current || !island) return
            onOpenIsland(island.id)
          }}
          title={island ? `${island.name} [${x}:${y}]` : `[${x}:${y}]`}
        >
          {island && (
            <>
              <div id={`wonder_${x}_${y}`} className={`wonder wonder${island.wonder}`} />
              <div
                id={`tradegood_${x}_${y}`}
                className={`tradegood tradegood${island.tradeResource}`}
              />
              <div id={`cities_${x}_${y}`} className="cities">
                {island.townCount > 0 ? island.townCount : ''}
              </div>
              <div id={`marking_${x}_${y}`} className="marking" />
              {/* Ownership border; read as marking.nextSibling by the legacy. */}
              <div />
              <div id={`magnify_${x}_${y}`} className="magnify" />
            </>
          )}
        </div>,
      )
    }
  }

  return (
    <div id="mainview">
      {/* #scrollcover is the clipper -- overflow:hidden, height:440px
          (design/skin/ik_worldmap_iso_0.0.1.css:110). Without it the tile
          plane spills out of the parchment frame. The inline background and
          z-index come from view/worldmap_iso.php:20-21. */}
      <div
        id="scrollcover"
        style={{
          overflow: 'hidden',
          backgroundImage: 'url(/skin/world/bg_ocean01.gif)',
          zIndex: 35,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          id="worldmap"
          style={{
            overflow: 'visible',
            position: 'absolute',
            zIndex: 40,
            left: 240 + offset.x,
            top: -300 + offset.y,
          }}
        >
          <div
            id="map1"
            style={{
              position: 'absolute',
              zIndex: 50,
              cursor: 'move',
              // Dragging must not select the labels underneath.
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            {tiles}
          </div>
        </div>
      </div>
      <div id="mapCoords">
        <span className="textLabel">
          {origin.x}:{origin.y}
        </span>
      </div>
    </div>
  )
}
