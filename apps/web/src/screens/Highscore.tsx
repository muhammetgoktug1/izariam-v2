/**
 * The highscore, izariam/views/view/highscore.php.
 *
 * The legacy offers twelve categories in the dropdown but only prints a score
 * for seven of them -- offense, defense, trade, resources and donations have a
 * `case` in the header switch and none in the value switch, so choosing one
 * gives a list of names with an empty score column. The five dead options are
 * dropped here rather than reproduced: they map to no stored column, so there
 * is nothing to show even in principle.
 *
 * Pagination is 100 rows, and the "own position" option (value -1) never
 * worked in the legacy either -- the controller has no branch for it.
 *
 * The alliance column is commented out in the original; there is no alliance
 * model. Kept as an empty cell so the column widths still add up to 100%.
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../lib/api.js'
import { num, t, tf } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen } from './context.js'

/** The seven categories that actually have a score behind them. */
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'total', label: 'total_score' },
  { key: 'buildings', label: 'master_builders' },
  { key: 'levels', label: 'building_levels' },
  { key: 'research', label: 'scientists' },
  { key: 'complete', label: 'research_levels' },
  { key: 'army', label: 'generals' },
  { key: 'gold', label: 'gold' },
]

export const HighscoreScreen: Screen = ({ ctx, sideboxes }) => {
  const [category, setCategory] = useState('total')
  const [page, setPage] = useState(0)

  const board = useQuery({
    queryKey: ['highscore', category, page],
    queryFn: () => api.highscore(category, page),
  })

  const pages = Math.max(1, Math.ceil((board.data?.total ?? 0) / 100))
  const label = t(CATEGORIES.find((c) => c.key === category)?.label ?? 'total_score')

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <h1>{t('game_top')}</h1>
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('game_top')}</span>
          </h3>
          <div className="content">
            <table className="highscore_search_table">
              <tbody>
                <tr>
                  <td>
                    <img src="/skin/layout/sieger_2.jpg" alt="" />
                  </td>
                  <td>
                    <div className="select_container">
                      <select
                        name="highscoreType"
                        value={category}
                        onChange={(e) => {
                          setCategory(e.target.value)
                          setPage(0)
                        }}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c.key} value={c.key}>
                            {t(c.label)}
                          </option>
                        ))}
                      </select>
                      <select
                        name="offset"
                        id="offset"
                        value={page}
                        onChange={(e) => setPage(Number(e.target.value))}
                      >
                        {Array.from({ length: pages }, (_, i) => (
                          <option key={i} value={i}>
                            {i * 100 + 1}- {(i + 1) * 100}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    {/* The search field posts to a controller branch that does
                        not exist; rendered, inert, as it was. */}
                    <p className="player_name_label">{t('username')}</p>
                    <input type="text" name="searchUser" defaultValue="" />
                    <div className="player_select">
                      <input type="checkbox" id="searchOnlyFriends" name="searchOnlyFriends" />
                      <label htmlFor="searchOnlyFriends">{t('search_friends')}</label>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <p>{tf('highscore_place_text', label, t('total_score'))}</p>

            <table className="table01">
              <tbody>
                <tr>
                  <th style={{ width: '15%' }}>{t('position')}</th>
                  <th style={{ width: '30%' }}>{t('username')}</th>
                  <th style={{ width: '15%' }}>{t('ally')}</th>
                  <th style={{ width: '20%' }}>{t('points')}</th>
                  <th style={{ width: '20%' }}>{t('actions')}</th>
                </tr>
                {(board.data?.rows ?? []).map((row) => {
                  const mine = row.userId === ctx.state.user.id
                  const classes = [
                    row.rank % 2 === 0 ? 'alt' : '',
                    page === 0 && row.rank === 1 ? 'first' : '',
                    page === 0 && row.rank === 2 ? 'second' : '',
                    page === 0 && row.rank === 3 ? 'third' : '',
                    mine ? 'own' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <tr key={row.userId} className={classes || undefined}>
                      <td className="place">{row.rank}</td>
                      <td className="name">{row.login}</td>
                      <td className="allytag" />
                      <td className="score">{num(row.value)}</td>
                      <td className="action">
                        {!mine && (
                          <a
                            title={t('create_message')}
                            href={hashFor('sendIKMessage', row.userId, encodeURIComponent(row.login))}
                            onClick={(e) => {
                              e.preventDefault()
                              ctx.navigate(hashFor('sendIKMessage', row.userId, encodeURIComponent(row.login)))
                            }}
                          >
                            <img
                              src="/skin/interface/icon_message_write.gif"
                              alt={t('create_message')}
                            />
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="contentBox01h">
            <div className="content">
              <p />
            </div>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}
