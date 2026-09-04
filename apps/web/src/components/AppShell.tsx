/**
 * The in-game chrome, composed in the legacy's document order.
 *
 * Order matters. izariam/views/game_index.php puts breadcrumbs, the sideboxes
 * and #mainview *before* the header chrome (:332-334 vs :335+); everything is
 * then placed by absolute CSS. Reordering changes the stacking result even
 * though the visual positions come from the stylesheet.
 *
 * The one rule that cannot be broken: nothing functional goes inside
 * `#header`. It is a decorative banner and the skin hides its contents
 * wholesale (`#header *{display:none}`, design/skin/ik_common_0.4.5.css:86).
 */

import type { ReactNode } from 'react'

import { Advisors } from './chrome/Advisors.js'
import { CityNav, type TownOption } from './chrome/CityNav.js'
import { CityResources, type ResourceRates } from './chrome/CityResources.js'
import { Footer } from './chrome/Footer.js'
import { Friends } from './chrome/Friends.js'
import { GameFrame } from './chrome/GameFrame.js'
import { GfToolbar } from './chrome/GfToolbar.js'
import { GlobalResources } from './chrome/GlobalResources.js'

export interface ChromeData {
  ambrosia: number
  gold: number
  freeTransports: number
  totalTransports: number
  towns: TownOption[]
  currentTownId: number
  displayMode: number
  stock: Record<'wood' | 'wine' | 'marble' | 'crystal' | 'sulfur', number>
  rates: ResourceRates
  capacity: number
  freePopulation: number
  maxPopulation: number
  actionPoints: number
  maxActionPoints: number
  sampledAt: number
  clockOffset: number
  hasPremium: boolean
  /** Page key -- the resource tooltips only show the tradegood line on the
   *  eight pages that load Island_Model. */
  page: string
  tradeResource: number
  tradegoodRate: number
  onSale: Record<'wood' | 'wine' | 'marble' | 'crystal' | 'sulfur', number>
  hasWealth: boolean
  newTownMessages: number
  newUserMessages: number
  researchAvailable: boolean
  version: string
}

interface Props {
  data: ChromeData
  breadcrumbs?: ReactNode
  /** The screen, which renders its own sideboxes ahead of #mainview. */
  children: ReactNode
  /** The notepad, when the player has it open. */
  notes?: ReactNode
  /** The tutorial overlay. Only rendered in the capital, and never on the
   *  highscore page (game_index.php:627). */
  tutorial?: ReactNode
  onSelectTown: (id: number) => void
  onNavigate: (page: string) => void
  onToggleNotes: () => void
  onLogout: () => void
}

export function AppShell({
  data,
  breadcrumbs,
  children,
  notes,
  tutorial,
  onSelectTown,
  onNavigate,
  onToggleNotes,
  onLogout,
}: Props) {
  return (
    <>
      <GameFrame>
        {/* The legacy ships both containers empty and fills them on demand
            (game_index.php:330-331). Chat was never implemented. */}
        <div id="avatarNotes" className="popup_window">
          {notes}
        </div>
        <div id="chatWindow" className="popup_window" />

        {breadcrumbs}
        {children}

        <CityNav
          towns={data.towns}
          currentTownId={data.currentTownId}
          displayMode={data.displayMode}
          onSelectTown={onSelectTown}
          onNavigate={onNavigate}
        />

        <GlobalResources
          ambrosia={data.ambrosia}
          freeTransports={data.freeTransports}
          totalTransports={data.totalTransports}
          gold={data.gold}
          onNavigate={onNavigate}
        />

        <CityResources
          stock={data.stock}
          rates={data.rates}
          capacity={data.capacity}
          freePopulation={data.freePopulation}
          maxPopulation={data.maxPopulation}
          actionPoints={data.actionPoints}
          maxActionPoints={data.maxActionPoints}
          sampledAt={data.sampledAt}
          clockOffset={data.clockOffset}
          page={data.page}
          tradeResource={data.tradeResource}
          tradegoodRate={data.tradegoodRate}
          onSale={data.onSale}
          hasWealth={data.hasWealth}
        />

        <Advisors
          hasPremium={data.hasPremium}
          newTownMessages={data.newTownMessages}
          newUserMessages={data.newUserMessages}
          researchAvailable={data.researchAvailable}
          onNavigate={onNavigate}
        />

        {tutorial}
        <Friends />
        <Footer onNavigate={onNavigate} />
      </GameFrame>

      <GfToolbar
        ambrosia={data.ambrosia}
        version={data.version}
        clockOffset={data.clockOffset}
        onNavigate={onNavigate}
        onToggleNotes={onToggleNotes}
        onLogout={onLogout}
      />
    </>
  )
}
