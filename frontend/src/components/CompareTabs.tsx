import { productHref, type ProductArea } from '../utils/productArea'

interface CompareTabsProps {
  active: ProductArea
  onNavigate: (area: ProductArea) => void
  onPreload: (area: ProductArea) => void
}

const TABS: { area: ProductArea; label: string; hint: string }[] = [
  { area: 'comparisons', label: 'Across CPUs', hint: 'Same code on every CPU in the run set' },
  { area: 'experiments', label: 'Code variants', hint: 'Source variants (via -D flags) across CPUs' },
  { area: 'lab', label: 'Hardware Lab', hint: 'Change one cache parameter and see what moves' },
]

/** Secondary navigation shared by the three Compare views. */
export function CompareTabs({ active, onNavigate, onPreload }: CompareTabsProps) {
  return (
    <nav className="compare-tabs" aria-label="Compare">
      {TABS.map(tab => (
        <a
          key={tab.area}
          href={productHref(tab.area)}
          className={`compare-tab${active === tab.area ? ' active' : ''}`}
          aria-current={active === tab.area ? 'page' : undefined}
          title={tab.hint}
          onClick={event => {
            event.preventDefault()
            onNavigate(tab.area)
          }}
          onPointerEnter={() => onPreload(tab.area)}
          onFocus={() => onPreload(tab.area)}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  )
}
