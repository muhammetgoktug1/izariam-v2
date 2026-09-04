/**
 * `div#backTo.dynamic` -- the "<< back to X" sidebox.
 *
 * Eight of the legacy's sidebox files are this same block with a different
 * image and label: backToCity, back_to_island, researchOverview, renameCity,
 * takeOffer, safehouseMissions, safehouseReports, premiumPayment. They differ
 * only in header text, image and destination, so they collapse into one
 * component and a table at the call site.
 *
 * Two of them hardcode English rather than going through the language file
 * (backToCity) and one hardcodes Russian (back_to_island, "Назад к острову").
 * Both are reproduced through the language file instead -- the strings exist
 * there, the templates just did not use them, and shipping a Russian label into
 * an English build is a bug rather than behaviour.
 */

interface Props {
  header: string
  label: string
  image: string
  href: string
  onNavigate: (hash: string) => void
  /** The legacy sizes most of these 160x100 but leaves takeOffer's unsized. */
  sized?: boolean
}

export function BackToBox({ header, label, image, href, onNavigate, sized = true }: Props) {
  return (
    <div id="backTo" className="dynamic">
      <h3 className="header">{header}</h3>
      <div className="content">
        <a
          href={href}
          title={label}
          onClick={(e) => {
            e.preventDefault()
            onNavigate(href)
          }}
        >
          <img src={image} alt="" {...(sized ? { width: 160, height: 100 } : {})} />
          <span className="textLabel">&lt;&lt; {label}</span>
        </a>
      </div>
      <div className="footer" />
    </div>
  )
}
