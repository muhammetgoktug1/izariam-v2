/**
 * `good_class_by_count` / `good_name_by_count` (data_model.php:930-980).
 *
 * The extracted `good_class_by_count` table in maps.json only samples the
 * function at eleven points, because that is all a lookup table can capture of
 * a chain of range tests. The bands are reproduced here instead so every value
 * in between lands in the right one.
 *
 * Note the top band starts at 300 in the function but the sampled table has
 * `ecstatic` only at 500 -- the table is the lossy one, and this follows the
 * function.
 */

import { t } from './i18n.js'

const BANDS: { min: number; key: string }[] = [
  { min: 300, key: 'ecstatic' },
  { min: 50, key: 'happy' },
  { min: 0, key: 'neutral' },
  { min: -49, key: 'sad' },
  { min: -Infinity, key: 'outraged' },
]

export function happinessClass(count: number): string {
  return BANDS.find((b) => count >= b.min)!.key
}

export function happinessName(count: number): string {
  return t(happinessClass(count))
}
