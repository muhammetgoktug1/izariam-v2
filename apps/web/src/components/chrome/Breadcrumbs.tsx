/**
 * The "World > Island > Town > ..." scroll above the main view.
 *
 * Ports all 14 reachable templates in izariam/views/bread/, dispatched by
 * `breadFor()` (lib/routes.ts) from view_model.php:18-88. The fifteenth,
 * bread/researchDetail.php, is unreachable -- :50 sends researchDetail to the
 * `null` template instead -- so it is not here.
 *
 * The templates split into two icon conventions and the first cut of this
 * component only knew one of them:
 *
 * - `_island`, `building`, `plunder`, `resource`, `town`, `tradeAdvisor` and
 *   `tradegood` render the world (and sometimes the island and town) crumb as
 *   an `<img>` off skin/layout/icon-*.gif.
 * - `city`, `island`, `world` render them as text inside `a.world` /
 *   `a.island`, which the skin gives its own background.
 *
 * Styled at design/skin/ik_common_0.4.5.css:88-104: a background scroll pinned
 * at top:147px left:250px, with variants on `a.world`, `a.island`, `a.city`,
 * `span.building`, `span.city`, `span.island` and `span.textLabel`.
 */

import { BUILDING_CLASS, MAPS } from '@izariam/gamedata'

import { t } from '../../lib/i18n.js'
import { hashFor, type BreadSpec, type Page } from '../../lib/routes.js'
import { buildingName, islandBuildingName } from '../../lib/buildings.js'

export interface BreadPlace {
  id: number
  name: string
  x: number
  y: number
}

export interface BreadContext {
  /** The island and town the player currently has selected. */
  island: BreadPlace
  town: { id: number; name: string }
  /**
   * The island the screen is *about*, which is not always the player's own:
   * the `_island`, `resource` and `tradegood` templates read Island_Model,
   * which the island/colonize/transport/sendSpy screens have pointed
   * elsewhere. Falls back to the player's island.
   */
  target?: BreadPlace
  /** `plunder` names a town on the target island, or a barbarian village. */
  targetTownName?: string
  /** The island's trade good, for the `tradegood` template's caption. */
  tradeResource?: number
}

interface Props {
  spec: BreadSpec
  context: BreadContext
  onNavigate: (hash: string) => void
}

const SEP = <span>&nbsp;&gt;&nbsp;</span>

function iconUrl(name: string): string {
  return `/skin/layout/icon-${name}.gif`
}

export function Breadcrumbs({ spec, context, onNavigate }: Props) {
  const { island, town } = context
  const target = context.target ?? island
  const caption = spec.captionKey ? t(spec.captionKey) : buildingName(spec.type ?? 0)

  const link = (hash: string, className: string | undefined, title: string, body: React.ReactNode) => (
    <a
      href={hash}
      className={className}
      title={title}
      onClick={(e) => {
        e.preventDefault()
        onNavigate(hash)
      }}
    >
      {body}
    </a>
  )

  const worldIcon = link(
    hashFor('worldmap_iso'),
    undefined,
    t('back_world'),
    <img src={iconUrl('world')} alt={t('world')} />,
  )
  const worldText = link(hashFor('worldmap_iso'), 'world', t('back_world'), t('world'))

  const islandText = (place: BreadPlace) =>
    link(
      hashFor('island', place.id),
      'island',
      t('back_island'),
      `${place.name}[${place.x}:${place.y}]`,
    )

  const islandIcon = (place: BreadPlace) =>
    link(
      hashFor('island', place.id),
      undefined,
      t('back_island'),
      <>
        <img src={iconUrl('island')} alt={place.name} /> [{place.x}:{place.y}]
      </>,
    )

  const cityIcon = link(
    hashFor('city'),
    undefined,
    t('back_town'),
    <img src={iconUrl('city2')} alt={town.name} />,
  )

  const body = (() => {
    switch (spec.template) {
      // A leaf label and nothing else.
      case 'null':
        return <span className="textLabel">{caption}</span>
      case 'informations':
      case 'pedia':
        return <span className="building">{t('full_info')}</span>

      case 'worldmap_iso':
        return <span className="world">{t('world')}</span>

      case 'world':
        return (
          <>
            {worldText}
            {SEP}
            <span className="building">{caption}</span>
          </>
        )

      case 'island':
        return (
          <>
            {worldText}
            {SEP}
            <span className="island">
              {target.name}[{target.x}:{target.y}]
            </span>
          </>
        )

      case 'city':
        return (
          <>
            {worldIcon}
            {SEP}
            {islandText(island)}
            {SEP}
            <span className="city">{town.name}</span>
          </>
        )

      // World icon, the *target* island, then the leaf. Used by the screens
      // that act on somewhere other than home.
      case '_island':
        return (
          <>
            {worldIcon}
            {SEP}
            {islandText(target)}
            {SEP}
            <span className="building">{caption}</span>
          </>
        )

      case 'resource':
        return (
          <>
            {worldIcon}
            {SEP}
            {islandText(target)}
            {SEP}
            <span className="building">{t('saw_mill')}</span>
          </>
        )

      case 'tradegood':
        return (
          <>
            {worldIcon}
            {SEP}
            {islandText(target)}
            {SEP}
            <span className="building">{islandBuildingName(context.tradeResource ?? 0)}</span>
          </>
        )

      case 'plunder':
        return (
          <>
            {worldIcon}
            {SEP}
            {islandText(island)}
            {SEP}
            <span className="city">{context.targetTownName ?? t('village')}</span>
          </>
        )

      case 'town':
        return (
          <>
            {worldIcon}
            {SEP}
            {islandIcon(island)}
            {SEP}
            {link(hashFor('city'), 'city', t('back_town'), town.name)}
            {SEP}
            <span className="building">{caption}</span>
          </>
        )

      // Five crumbs: the extra one links back to the building this screen
      // hangs off, e.g. demolition -> the building being demolished.
      case 'building': {
        const type = spec.type ?? 0
        const page = (BUILDING_CLASS[String(type)] ?? 'city') as Page
        return (
          <>
            {worldIcon}
            {SEP}
            {islandIcon(island)}
            {SEP}
            {cityIcon}
            {SEP}
            {link(hashFor(page), 'building', buildingName(type), buildingName(type))}
            {SEP}
            <span className="building">{caption}</span>
          </>
        )
      }

      case 'tradeAdvisor':
        return (
          <>
            {worldIcon}
            {SEP}
            {link(hashFor('tradeAdvisor'), 'building', t('mayor'), t('mayor'))}
            {SEP}
            <span className="building">{caption}</span>
          </>
        )
    }
  })()

  return (
    <div id="breadcrumbs">
      <h3>{t('you_here')}:</h3>
      {body}
    </div>
  )
}

