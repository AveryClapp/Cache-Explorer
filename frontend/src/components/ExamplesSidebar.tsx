import { EXAMPLES } from '../constants'
import { generateFileId } from '../utils/file'
import { getFileExtension } from '../hooks'
import type { Language, FileTab } from '../types'

type ExampleLangFilter = 'all' | 'c' | 'cpp' | 'rust'

interface ExamplesSidebarProps {
  collapsed: boolean
  onToggle: () => void
  langFilter: ExampleLangFilter
  onLangFilterChange: (filter: ExampleLangFilter) => void
  currentCode: string
  onLoadExample: (files: FileTab[], mainFileId: string) => void
  onUpdateFile: (code: string, language: Language, name: string) => void
}

export function ExamplesSidebar({
  collapsed,
  onToggle,
  langFilter,
  onLangFilterChange,
  currentCode,
  onLoadExample,
  onUpdateFile,
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
                onClick={() => {
                  if (ex.files && ex.files.length > 0) {
                    const newFiles = ex.files.map((f) => ({
                      id: generateFileId(),
                      name: f.name,
                      code: f.code,
                      language: f.language,
                      isMain: f.isMain
                    }))
                    const mainFile = newFiles.find(f => f.isMain) || newFiles[0]
                    onLoadExample(newFiles, mainFile.id)
                  } else {
                    onUpdateFile(ex.code, ex.language, 'main' + getFileExtension(ex.language))
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="example-name">{ex.name}</span>
                  <span className={`example-lang ${ex.language}`}>{ex.language === 'cpp' ? 'C++' : ex.language === 'rust' ? 'Rust' : 'C'}</span>
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
