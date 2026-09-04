/**
 * The three `Data_Model::building_*_by_type` helpers.
 *
 * `buildingName` used to derive a name from the CSS class -- "forester" ->
 * "Forester" -- which is not what the game calls it: `building16_name` is
 * "Forester`s House". Every label now comes from the language file, as the
 * legacy's did.
 */

import { BUILDING_CLASS, MAPS } from '@izariam/gamedata'

import { t } from './i18n.js'

/**
 * Building type -> the css class the skin paints it with
 * (data_model.php:519). Unknown types fall back to empty ground.
 */
export function buildingClass(type: number): string {
  return BUILDING_CLASS[String(type)] ?? 'buildingGround'
}

/**
 * The building's name (data_model.php:401-426). The switch has a `default`
 * that returns `building0_name`, so an unknown type reads "Free Building
 * Ground" rather than blank.
 */
export function buildingName(type: number): string {
  return type >= 1 && type <= 27 ? t(`building${type}_name`) : t('building0_name')
}

/**
 * The building's description (data_model.php:441-473). Unlike the name switch
 * this one has *no* default, so type 0 -- empty ground -- returns null and the
 * template prints nothing. Reproduced: an empty slot's description is blank,
 * not the string "building0_desc".
 */
export function buildingDesc(type: number): string {
  return type >= 1 && type <= 27 ? t(`building${type}_desc`) : ''
}

/** Island trade resource id -> its resource name. */
export function tradeResourceName(id: number): string {
  const map = MAPS.resource_class_by_type ?? {}
  return String(map[String(id)] ?? 'wood')
}

/**
 * Island trade resource id -> the name of the node that works it.
 *
 * `MAPS.island_building_by_resource` also answers this, but its values come
 * from the extracted PHP and are English strings -- `Forest`, `Vines`,
 * `Quarry`, `Crystal Mine`, `Sulfur Pit`. Three screens read that map directly
 * and printed English into a Turkish UI. The language file has had the
 * translated names all along under `island_building_*`, so the lookup goes
 * through the catalog instead.
 */
export function islandBuildingName(tradeResource: number): string {
  return t(`island_building_${tradeResourceName(tradeResource)}`)
}

/**
 * Unit type -> css class, name and description
 * (data_model.php:133-200 and the two switches beside it).
 *
 * Land units are 1..15, ships 16..23. `army_class_by_type` has entries for 0,
 * 24 and 25 that are null, so anything outside 1..23 has no sprite.
 */
export function armyClass(type: number): string {
  const map = (MAPS.army_class_by_type ?? {}) as Record<string, string | null>
  return map[String(type)] ?? ''
}

export function armyName(type: number): string {
  return type >= 1 && type <= 25 ? t(`army${type}_name`) : ''
}

export function armyDesc(type: number): string {
  return type >= 1 && type <= 25 ? t(`army${type}_desc`) : ''
}
