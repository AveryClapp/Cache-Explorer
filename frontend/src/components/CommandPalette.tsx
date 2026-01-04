export interface CommandItem {
  id: string
  icon: string
  label: string
  shortcut?: string
  action: () => void
  category?: string
}

interface CommandPaletteProps {
  isOpen: boolean
  query: string
  selectedIndex: number
  onQueryChange: (query: string) => void
  onSelect: (cmd: CommandItem) => void
  onClose: () => void
  onNavigate: (delta: number) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  commands: CommandItem[]
}

// Prefix-to-category mapping for command palette
const PREFIX_CATEGORIES: Record<string, string> = {
  '>': 'examples',
  ':': 'settings',
  '@': 'actions',
  '*': 'config',
}

const CATEGORY_LABELS: Record<string, string> = {
  'examples': 'Examples',
  'settings': 'Settings',
  'actions': 'Actions',
  'config': 'Config',
}

const CATEGORY_ORDER = ['actions', 'examples', 'settings', 'config']

// Fuzzy match helper
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export function CommandPalette({
  isOpen,
  query,
  selectedIndex,
  onQueryChange,
  onSelect,
  onClose,
  onNavigate,
  inputRef,
  commands
}: CommandPaletteProps) {
  if (!isOpen) return null

  // Parse prefix from query
  const firstChar = query.charAt(0)
  const activePrefix = PREFIX_CATEGORIES[firstChar] ? firstChar : null
  const activeCategory = activePrefix ? PREFIX_CATEGORIES[activePrefix] : null
  const searchQuery = activePrefix ? query.slice(1).trim() : query

  // Filter commands
  let filtered: CommandItem[]
  if (activeCategory) {
    filtered = commands.filter(cmd => cmd.category === activeCategory)
    if (searchQuery) {
      filtered = filtered.filter(cmd => fuzzyMatch(searchQuery, cmd.label))
    }
  } else if (searchQuery) {
    filtered = commands.filter(cmd => fuzzyMatch(searchQuery, cmd.label) || fuzzyMatch(searchQuery, cmd.category || ''))
  } else {
    filtered = commands
  }

  // Group by category when showing all (no prefix, no search)
  const showGrouped = !activePrefix && !searchQuery
  const groupedCommands: { category: string; items: CommandItem[] }[] = []
  if (showGrouped) {
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter(cmd => cmd.category === cat)
      if (items.length > 0) {
        groupedCommands.push({ category: cat, items })
      }
    }
  }

  // Flatten for keyboard navigation
  const flatFiltered = showGrouped
    ? groupedCommands.flatMap(g => g.items)
    : filtered

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onNavigate(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onNavigate(-1)
    } else if (e.key === 'Enter' && flatFiltered[selectedIndex]) {
      e.preventDefault()
      onSelect(flatFiltered[selectedIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Backspace' && query === activePrefix) {
      e.preventDefault()
      onQueryChange('')
    }
  }

  const clearPrefix = () => {
    onQueryChange('')
  }

  // Render grouped or flat list
  const renderCommands = () => {
    if (showGrouped) {
      let globalIndex = 0
      return groupedCommands.map(group => (
        <div key={group.category} className="command-group">
          <div className="command-group-header">{CATEGORY_LABELS[group.category]}</div>
          {group.items.map(cmd => {
            const idx = globalIndex++
            return (
              <div
                key={cmd.id}
                className={`command-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => onNavigate(idx - selectedIndex)}
              >
                <span className="command-item-icon">{cmd.icon}</span>
                <span className="command-item-label">{cmd.label}</span>
                {cmd.shortcut && <span className="command-item-shortcut">{cmd.shortcut}</span>}
              </div>
            )
          })}
        </div>
      ))
    }
    return flatFiltered.map((cmd, i) => (
      <div
        key={cmd.id}
        className={`command-item ${i === selectedIndex ? 'selected' : ''}`}
        onClick={() => onSelect(cmd)}
        onMouseEnter={() => onNavigate(i - selectedIndex)}
      >
        <span className="command-item-icon">{cmd.icon}</span>
        <span className="command-item-label">{cmd.label}</span>
        {cmd.shortcut && <span className="command-item-shortcut">{cmd.shortcut}</span>}
      </div>
    ))
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-input-wrapper">
          {activePrefix ? (
            <span className="command-filter-badge" onClick={clearPrefix}>
              {CATEGORY_LABELS[activeCategory!]} {activePrefix}
              <span className="badge-clear">×</span>
            </span>
          ) : (
            <span className="command-icon">/</span>
          )}
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            placeholder={activePrefix ? `Search ${CATEGORY_LABELS[activeCategory!].toLowerCase()}...` : '> examples  : settings  @ actions  * config'}
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div className="command-list">
          {renderCommands()}
          {flatFiltered.length === 0 && (
            <div className="command-empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  )
}
