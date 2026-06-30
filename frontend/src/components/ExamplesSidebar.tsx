import { EXAMPLES } from '../constants'

type ExampleLangFilter = 'all' | 'c' | 'cpp' | 'zig' | 'rust'

interface ExamplesSidebarProps {
  collapsed: boolean
  onToggle: () => void
  langFilter: ExampleLangFilter
  onLangFilterChange: (filter: ExampleLangFilter) => void
  currentCode: string
  onLoadExample: (exampleKey: string) => void
}

export function ExamplesSidebar({
  collapsed,
  onToggle,
  langFilter,
  onLangFilterChange,
  currentCode,
  onLoadExample,
}: ExamplesSidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <button
        className="sidebar-toggle"
        onClick={onToggle}
        title={collapsed ? 'Show examples' : 'Hide examples'}
      >
        {collapsed ? '›' : '‹'}
      </button>
      {!collapsed && (
        <div className="sidebar-section" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="sidebar-title">Examples</div>
          <div className="language-filter">
            <button
              className={`language-filter-btn${langFilter === 'all' ? ' active' : ''}`}
              onClick={() => onLangFilterChange('all')}
            >All</button>
            <button
              className={`language-filter-btn${langFilter === 'c' ? ' active' : ''}`}
              onClick={() => onLangFilterChange('c')}
            >C</button>
            <button
              className={`language-filter-btn${langFilter === 'cpp' ? ' active' : ''}`}
              onClick={() => onLangFilterChange('cpp')}
            >C++</button>
            <button
              className={`language-filter-btn${langFilter === 'zig' ? ' active' : ''}`}
              onClick={() => onLangFilterChange('zig')}
            >Zig</button>
            <button
              className={`language-filter-btn${langFilter === 'rust' ? ' active' : ''}`}
              onClick={() => onLangFilterChange('rust')}
            >Rust</button>
          </div>
          <div className="example-list" style={{ flex: 1, overflowY: 'auto' }}>
            {Object.entries(EXAMPLES)
              .filter(([, ex]) => langFilter === 'all' || ex.language === langFilter)
              .map(([key, ex]) => (
              <button
                key={key}
                className={`example-item${currentCode === ex.code ? ' active' : ''}`}
                onClick={() => onLoadExample(key)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="example-name">{ex.name}</span>
                  <span className={`example-lang ${ex.language}`}>
                    {ex.language === 'cpp' ? 'C++' : ex.language === 'zig' ? 'Zig' : ex.language === 'rust' ? 'Rust' : 'C'}
                  </span>
                </div>
                <span className="example-desc">{ex.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

export type { ExampleLangFilter }
