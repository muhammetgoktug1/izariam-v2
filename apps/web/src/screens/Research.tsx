/**
 * The three research screens: the advisor, the library archive and one node's
 * detail page.
 *
 * izariam/views/view/{researchAdvisor,researchOverview,researchDetail}.php.
 *
 * The four branches are 14, 15, 16 and 14 nodes long -- not equal, and the
 * clamps in `get_research` are what enforce it. `researchWays()` walks each
 * branch for the first unresearched node and that is what the advisor offers;
 * a branch whose every node below its repeatable future tech is finished
 * leaves `ways[way]` undefined and the legacy renders a blank cell.
 *
 * The branch names are hardcoded Russian in all three legacy files, but the
 * language file names them anyway under `way1_name` .. `way4_name`, so those
 * keys are what this uses.
 */

import { RESEARCH_BRANCH_SIZE } from '@izariam/gamedata'
import { researchInfo, researchWays } from '@izariam/rules'

import { num, t, tf } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

/** The four research branches. The legacy calls a branch a "way", and the
 *  language file already names all four (`way1_name` .. `way4_name`). */
const BRANCHES: { way: number; image: string }[] = [
  { way: 1, image: 'changeResearchSeafaring' },
  { way: 2, image: 'changeResearchEconomy' },
  { way: 3, image: 'changeResearchKnowledge' },
  { way: 4, image: 'changeResearchMilitary' },
]

function branchName(way: number): string {
  return t(`way${way}_name`)
}

function nodeName(way: number, id: number): string {
  return t(`research${way}_${id}_name`)
}

function researched(ctx: ScreenContext, way: number, id: number): boolean {
  return (ctx.state.user.research.levels[`${way}_${id}`] ?? 0) > 0
}

/**
 * The price tag beside the research button (researchAdvisor.php:68-73).
 *
 * `.researchType .costs` is absolutely positioned at top:75px left:360px and
 * `ul.resources .researchPoints` carries the research icon as a background
 * (ik_common_0.4.5.css:865-866, :879-880), so the whole three-element nest has
 * to be there for the number to land in the right column with its icon. The
 * `<h5>` is parked off-screen by the skin -- it exists for screen readers.
 */
function ResearchCost({ points }: { points: number }) {
  return (
    <div className="costs">
      <h5>{t('cost')}:</h5>
      <ul className="resources">
        <li className="researchPoints">{num(points)}</li>
      </ul>
    </div>
  )
}

/** researchAdvisor.php -- one card per branch with what it is working on. */
export const ResearchAdvisorScreen: Screen = ({ ctx, sideboxes }) => {
  const { ways } = researchWays(ctx.state.user.research)
  const points = ctx.state.user.research.points

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('research_advisor')}</h1>
          <p />
        </div>
        <div className="contentBox01h" id="currentResearch">
          <h3 className="header">
            <span className="textLabel">{t('current_research')}</span>
          </h3>
          <div className="content">
            <ul className="researchTypes">
              {BRANCHES.map((branch) => {
                const info = ways[branch.way]
                const blocked = info ? info.need_id > 0 : false
                const need = blocked ? researchInfo(info!.need_way, info!.need_id, ctx.state.user.research) : null
                const affordable = info ? info.points <= points : false

                return (
                  <li key={branch.way} className="researchType">
                    <div className="researchInfo" style={{ width: '100px', minHeight: '120px' }}>
                      <h4>
                        {info ? (
                          <a
                            href={hashFor('researchDetail', branch.way, info.id)}
                            onClick={(e) => {
                              e.preventDefault()
                              ctx.navigate(hashFor('researchDetail', branch.way, info.id))
                            }}
                          >
                            {nodeName(branch.way, info.id)}
                          </a>
                        ) : null}
                      </h4>
                      <div className="leftBranch">
                        <img src={`/skin/layout/${branch.image}.jpg`} alt="" />
                        <div className="researchTypeLabel">
                          <div className="unitcount">
                            <span className="textLabel">
                              <span className="before" />
                              {branchName(branch.way)}
                              <span className="after" />
                            </span>
                          </div>
                        </div>
                      </div>
                      <p>{info ? t(`research${branch.way}_${info.id}_desc`) : ''}</p>

                      {/* The three states researchAdvisor.php:53-91 renders,
                          and what each one is allowed to show. The cost block
                          belongs to the last two only. */}
                      {!info ? null : blocked ? (
                        <div className="researchButton2">
                          {tf(
                            'prerequisite_unresearched',
                            nodeName(info.need_way, need!.id),
                          )}
                        </div>
                      ) : !affordable ? (
                        <>
                          <div className="researchButton2">
                            {t('not_enough_research_points')}
                          </div>
                          <ResearchCost points={info.points} />
                        </>
                      ) : (
                        <>
                          <div className="researchButton">
                            {/* `build` is the class the skin positions off --
                                `#mainview .researchType a.build{position:absolute;
                                top:42px;left:550px;width:100px}`
                                (ik_common_0.4.5.css:859-860). Without it the
                                anchor stays in the flow and drops under the
                                description; `button` alone only paints it. */}
                            <a
                              className="button build"
                              style={{ paddingLeft: 3, paddingRight: 3 }}
                              href="#"
                              onClick={(e) => {
                                e.preventDefault()
                                void ctx.act('doResearch', { way: branch.way, id: info.id })
                              }}
                            >
                              <span className="textLabel">{t('research')}</span>
                            </a>
                          </div>
                          <ResearchCost points={info.points} />
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

/** researchOverview.php -- every node in every branch, explored or not. */
export const ResearchOverviewScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('previous_research')}</h1>
        <p>{t('previous_research_text')}</p>
      </div>
      <div className="contentBox01h">
        <h3 className="header">
          <span className="textLabel">{t('research_done')}</span>
        </h3>
        <div className="content">
          {BRANCHES.map((branch, i) => (
            <div key={branch.way}>
              {i > 0 && (
                <>
                  <br />
                  <hr />
                </>
              )}
              <h4>{branchName(branch.way)}</h4>
              <ul>
                {Array.from(
                  { length: RESEARCH_BRANCH_SIZE[branch.way] ?? 0 },
                  (_, n) => n + 1,
                ).map((id) => (
                  <li
                    key={id}
                    className={researched(ctx, branch.way, id) ? 'explored' : 'unexplored'}
                  >
                    <a
                      href={hashFor('researchDetail', branch.way, id)}
                      title={nodeName(branch.way, id)}
                      onClick={(e) => {
                        e.preventDefault()
                        ctx.navigate(hashFor('researchDetail', branch.way, id))
                      }}
                    >
                      {nodeName(branch.way, id)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)

/**
 * researchDetail.php -- one node: what it costs, what it needs, what it gives.
 *
 * The URL is `researchDetail/{way}/{id}`, and the advisor links to it with the
 * way in the first slot -- except from one place, where it hardcodes way 1
 * (researchAdvisor.php:13). Clamped rather than trusted.
 */
export const ResearchDetailScreen: Screen = ({ ctx, sideboxes }) => {
  const way = Math.min(4, Math.max(1, ctx.route.params[0] || 1))
  const size = RESEARCH_BRANCH_SIZE[way] ?? 1
  const id = Math.min(size, Math.max(1, ctx.route.params[1] || 1))

  const info = researchInfo(way, id, ctx.state.user.research)
  const done = researched(ctx, way, id)
  const points = ctx.state.user.research.points
  const branch = BRANCHES.find((b) => b.way === way)!

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{nodeName(way, id)}</h1>
          <p>{t(`research${way}_${id}_desc`)}</p>
        </div>
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{branchName(branch.way)}</span>
          </h3>
          <div className="content">
            <table className="table01">
              <tbody>
                <tr>
                  <th>{t('research_points')}</th>
                  <td>{num(info.points)}</td>
                </tr>
                <tr className="alt">
                  <th>{t('available')}</th>
                  <td>{num(points)}</td>
                </tr>
                <tr>
                  <th>{t('status')}</th>
                  <td className={done ? 'explored' : 'unexplored'}>
                    {done ? t('explored') : t('unexplored')}
                  </td>
                </tr>
                {info.need_id > 0 && (
                  <tr className="alt">
                    <th>{t('requirements')}</th>
                    <td>
                      <a
                        href={hashFor('researchDetail', info.need_way, info.need_id)}
                        onClick={(e) => {
                          e.preventDefault()
                          ctx.navigate(hashFor('researchDetail', info.need_way, info.need_id))
                        }}
                      >
                        {nodeName(info.need_way, info.need_id)}
                      </a>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {!done && info.need_id === 0 && info.points <= points && (
              <div className="centerButton">
                <a
                  className="button"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    void ctx.act('doResearch', { way, id })
                  }}
                >
                  {t('research')}
                </a>
              </div>
            )}
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}
