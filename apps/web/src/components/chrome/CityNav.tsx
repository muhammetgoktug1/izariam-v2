/**
 * Town switcher and the world/island/city buttons.
 * Reproduces izariam/views/game_index.php:335-401.
 *
 * The legacy ships a real <select id="citySelect"> and then destroys it:
 * replaceSelect() (design/js/complete-0.4.5.js:39) parks the original
 * off-screen with `.replaced` and builds
 *
 *   div.citySelect.smallFont.jsSelect
 *     div.dropbutton            (+ dropbutton_expanded when open)
 *     ul.optionList             (+ optionList_expanded when open)
 *       li.first / li / li.last (+ hover)
 *
 * which is what design/skin/ik_common_0.4.5.css:143-176 actually styles. So
 * the widget markup is emitted directly here, with a hidden real <select>
 * kept alongside for keyboard and screen-reader use.
 *
 * Note the skin positions the dropdown off the *class*, not the id
 * (`#cityNav .citySelect{position:absolute;top:6px;left:12px}`), so the class
 * has to be on the element that is meant to sit there.
 */

import { useEffect, useRef, useState } from 'react'

import { t } from '../../lib/i18n.js'

export interface TownOption {
  id: number
  name: string
  x: number
  y: number
  tradeResource: number
}

interface Props {
  towns: TownOption[]
  currentTownId: number
  /** users.options_select: 0 name, 1 [x:y] name, 2 tradegood icon + name. */
  displayMode: number
  onSelectTown: (id: number) => void
  onNavigate: (page: string) => void
}

function optionLabel(town: TownOption, mode: number): string {
  if (mode === 1) return `[${town.x}:${town.y}] ${town.name}`
  return town.name
}

function optionClass(town: TownOption, mode: number): string {
  if (mode === 1) return 'coords'
  if (mode === 2) return `tradegood${town.tradeResource}`
  return ''
}

export function CityNav({
  towns,
  currentTownId,
  displayMode,
  onSelectTown,
  onNavigate,
}: Props) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Clicking anywhere else closes the list, as the legacy widget does.
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const current = towns.find((t) => t.id === currentTownId) ?? towns[0]
  const index = towns.findIndex((t) => t.id === currentTownId)

  const step = (delta: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (towns.length === 0) return
    const next = towns[(index + delta + towns.length) % towns.length]
    if (next) onSelectTown(next.id)
  }

  const go = (page: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    onNavigate(page)
  }

  return (
    <div id="cityNav">
      <form
        id="changeCityForm"
        method="post"
        onSubmit={(e) => e.preventDefault()}
      >
        <fieldset style={{ display: 'none' }}>
          <input type="hidden" name="action" value="header" readOnly />
          <input type="hidden" name="function" value="changeCurrentCity" readOnly />
        </fieldset>
        <h3>{t('town_navigation')}</h3>
        <ul>
          <li>
            <label htmlFor="citySelect">{t('city')}</label>

            {/* Kept for keyboard and assistive tech; the skin parks it. */}
            <select
              id="citySelect"
              className="replaced"
              name="cityId"
              value={current?.id ?? ''}
              onChange={(e) => onSelectTown(Number(e.target.value))}
            >
              {towns.map((t) => (
                <option key={t.id} value={t.id}>
                  {optionLabel(t, displayMode)}
                </option>
              ))}
            </select>

            <div ref={rootRef} className="citySelect smallFont jsSelect">
              <div
                className={open ? 'dropbutton dropbutton_expanded' : 'dropbutton'}
                onClick={() => setOpen((v) => !v)}
              >
                {current ? optionLabel(current, displayMode) : ''}
              </div>
              <ul className={open ? 'optionList optionList_expanded' : 'optionList'}>
                {towns.map((t, i) => {
                  const classes = [
                    optionClass(t, displayMode),
                    i === 0 ? 'first' : '',
                    i === towns.length - 1 ? 'last' : '',
                    hovered === t.id ? 'hover' : '',
                    t.id === currentTownId ? 'active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <li
                      key={t.id}
                      className={classes}
                      onMouseEnter={() => setHovered(t.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => {
                        setOpen(false)
                        onSelectTown(t.id)
                      }}
                    >
                      {displayMode === 2 && <span className="cityresource" />}
                      {optionLabel(t, displayMode)}
                    </li>
                  )
                })}
              </ul>
            </div>
          </li>

          <li className="previousCity">
            <a href="#changeCityPrevious" tabIndex={2} onClick={step(-1)}>
              <span className="textLabel">{t('previous_town')}</span>
            </a>
          </li>
          <li className="nextCity">
            <a href="#changeCityNext" tabIndex={3} onClick={step(1)}>
              <span className="textLabel">{t('next_town')}</span>
            </a>
          </li>
          <li className="viewWorldmap">
            <a href="#/worldmap_iso" tabIndex={4} onClick={go('worldmap_iso')}>
              <span className="textLabel">{t('show_world')}</span>
            </a>
          </li>
          <li className="viewIsland">
            <a href="#/island" tabIndex={5} onClick={go('island')}>
              <span className="textLabel">{t('show_island')}</span>
            </a>
          </li>
          <li className="viewCity">
            <a href="#/city" tabIndex={6} onClick={go('city')}>
              <span className="textLabel">{t('show_town')}</span>
            </a>
          </li>
        </ul>
      </form>
    </div>
  )
}
